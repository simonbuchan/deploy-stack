import * as CloudFormation from "aws-sdk/clients/cloudformation";
import { StackWaiter } from "./deployStack";

export default function createEventLogWaiter(): StackWaiter {
  let lastEventPrinted = new Date();
  let maxResourceTypeLength: number | undefined;
  let maxResourceIdLength: number | undefined;

  return {
    async progress({ client, reason, stackName, changes }) {
      await printNewEvents(client, stackName, changes);
    },
    async complete({ client, reason, stackName, changes }) {
      await printNewEvents(client, stackName, changes);
      console.log("Waiting for %s complete", reason);
    },
  };

  async function printNewEvents(
    client: CloudFormation,
    stackName: string,
    changes: CloudFormation.Changes | null,
  ) {
    let firstEventRead: Date | undefined;
    let lastEventRead: Date | undefined;
    let nextEventToken: CloudFormation.NextToken | undefined = undefined;

    if (!maxResourceIdLength) {
      if (changes) {
        maxResourceTypeLength = maxStringLength(
          changes
            .filter(change => change.Type === "Resource")
            .map(change => change.ResourceChange!.ResourceType!),
          "AWS::CloudFormation::Stack".length,
        );
        maxResourceIdLength = maxStringLength(
          changes
            .filter(change => change.Type === "Resource")
            .map(change => change.ResourceChange!.LogicalResourceId!),
          stackName.length,
        );
      } else {
        const response = await client
          .describeStackResources({
            StackName: stackName,
          })
          .promise();
        maxResourceTypeLength = maxStringLength(
          response.StackResources!.map(r => r.ResourceType!),
          "AWS::CloudFormation::Stack".length,
        );
        maxResourceIdLength = maxStringLength(
          response.StackResources!.map(r => r.LogicalResourceId!),
          stackName.length,
        );
      }
    }

    do {
      let eventResponse: CloudFormation.DescribeStackEventsOutput = await client
        .describeStackEvents({
          StackName: stackName,
          NextToken: nextEventToken,
        })
        .promise();

      let events = eventResponse.StackEvents || [];

      if (events.length) {
        if (!firstEventRead) {
          firstEventRead = events[0].Timestamp;
        }
        lastEventRead = events[events.length - 1].Timestamp;

        const newEvents = events.filter(
          event => event.Timestamp > lastEventPrinted,
        );

        for (const event of newEvents) {
          console.log(
            [
              padRight(event.Timestamp.toISOString(), 24),
              padRight(event.ResourceType, maxResourceTypeLength!),
              padRight(event.LogicalResourceId, maxResourceIdLength),
              padRight(event.ResourceStatus, 18),
              event.ResourceStatusReason,
            ].join(" | "),
          );
        }
      }

      nextEventToken = eventResponse.NextToken;
    } while (nextEventToken && lastEventRead! > lastEventPrinted);
    if (firstEventRead) {
      lastEventPrinted = firstEventRead;
    }
  }
}

function maxStringLength(values: string[], min = 0) {
  return values.reduce((a, r) => Math.max(a, r.length), min);
}

function padRight(value: unknown, length: number) {
  const str = `${value}`;
  const padLength = length - str.length;
  return padLength <= 0 ? str : str + " ".repeat(padLength);
}
