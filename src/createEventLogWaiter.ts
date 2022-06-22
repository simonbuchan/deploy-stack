import * as CloudFormation from "@aws-sdk/client-cloudformation";
import { StackWaiter } from "./deployStack";

export default function createEventLogWaiter(): StackWaiter {
  let lastEventPrinted = new Date();
  let maxResourceTypeLength: number | undefined;
  let maxResourceIdLength: number | undefined;

  return {
    async progress({ client, stackName, changes }) {
      await printNewEvents(client, stackName, changes);
    },
    async complete({ client, reason, stackName, changes }) {
      await printNewEvents(client, stackName, changes);
      console.log("Waiting for %s complete", reason);
    },
  };

  async function printNewEvents(
    client: CloudFormation.CloudFormationClient,
    stackName: string,
    changes: CloudFormation.Change[] | null,
  ) {
    let firstEventRead: Date | undefined;
    let lastEventRead: Date | undefined;

    if (!maxResourceIdLength) {
      if (changes) {
        maxResourceTypeLength = maxStringLength(
          changes
            .filter((change) => change.Type === "Resource")
            .map((change) => change.ResourceChange!.ResourceType!),
          "AWS::CloudFormation::Stack".length,
        );
        maxResourceIdLength = maxStringLength(
          changes
            .filter((change) => change.Type === "Resource")
            .map((change) => change.ResourceChange!.LogicalResourceId!),
          stackName.length,
        );
      } else {
        const response = await client.send(
          new CloudFormation.DescribeStackResourcesCommand({
            StackName: stackName,
          }),
        );
        maxResourceTypeLength = maxStringLength(
          response.StackResources!.map((r) => r.ResourceType!),
          "AWS::CloudFormation::Stack".length,
        );
        maxResourceIdLength = maxStringLength(
          response.StackResources!.map((r) => r.LogicalResourceId!),
          stackName.length,
        );
      }
    }

    for await (const eventResponse of CloudFormation.paginateDescribeStackEvents(
      { client },
      { StackName: stackName },
    )) {
      let events = eventResponse.StackEvents || [];

      if (events.length) {
        if (!firstEventRead) {
          firstEventRead = events[0].Timestamp;
        }
        lastEventRead = events[events.length - 1].Timestamp;

        const newEvents = events.filter(
          (event) => event.Timestamp! > lastEventPrinted,
        );

        for (const event of newEvents) {
          console.log(
            [
              event.Timestamp?.toISOString().padEnd(24),
              event.ResourceType?.padEnd(maxResourceTypeLength!),
              event.LogicalResourceId?.padEnd(maxResourceIdLength),
              event.ResourceStatus?.padEnd(18),
              event.ResourceStatusReason,
            ].join(" | "),
          );
        }
      }
      if (lastEventRead! <= lastEventPrinted) {
        break;
      }
    }
    if (firstEventRead) {
      lastEventPrinted = firstEventRead;
    }
  }
}

function maxStringLength(values: string[], min = 0) {
  return values.reduce((a, r) => Math.max(a, r.length), min);
}
