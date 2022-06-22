import * as CloudFormation from "@aws-sdk/client-cloudformation";
import logUpdate from "log-update";
import { getBorderCharacters, table } from "table";

import { StackWaiter } from "./deployStack";

export default function createTableWaiter(): StackWaiter {
  return {
    async progress({ client, stack }) {
      if (!stack) return;
      const [resources, events] = await Promise.all([
        client.send(
          new CloudFormation.DescribeStackResourcesCommand({
            StackName: stack.StackName,
          }),
        ),
        client.send(
          new CloudFormation.DescribeStackEventsCommand({
            StackName: stack.StackName,
          }),
        ),
      ]);

      const now = Date.now();
      logUpdate(`\
Stack status: ${stack.StackStatus}: ${stack.StackStatusReason}
Resources:
${renderTable(
  ["Logical", "Physical", "Type", "Status", "Reason"],
  resources.StackResources!.map((resource) => [
    resource.LogicalResourceId,
    resource.PhysicalResourceId,
    resource.ResourceType,
    resource.ResourceStatus,
    resource.ResourceStatusReason,
  ]),
)}
Last 5 events:
${renderTable(
  ["Age", "Logical", "Status", "Reason"],
  events
    .StackEvents!.slice(0, 5)
    .map((event) => [
      `${((now - event.Timestamp!.valueOf()) / 1000).toFixed()}s`,
      event.LogicalResourceId,
      event.ResourceStatus,
      event.ResourceStatusReason,
    ]),
)}`);
    },
    async complete({ reason }) {
      if (reason !== "EXECUTING") {
        logUpdate.clear();
      } else {
        logUpdate.done();
      }
    },
  };
}

function renderTable(header: string[], data: any[][]) {
  return table([header, ...data], {
    border: getBorderCharacters("void"),
    columnDefault: {
      paddingLeft: 0,
      paddingRight: 1,
    },
    drawHorizontalLine: () => false,
  });
}
