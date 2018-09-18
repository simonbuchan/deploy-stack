import * as CloudFormation from "aws-sdk/clients/cloudformation";
import { URLSearchParams } from "url";
import * as util from "util";

const sleep = util.promisify(setTimeout);

export class DeployStackError extends Error {}

export class InvalidStatusBeforeUpdateStackError extends DeployStackError {
  public stackDetails: CloudFormation.Stack;
  constructor(stackDetails: CloudFormation.Stack) {
    const { StackName, StackStatus, StackStatusReason } = stackDetails;
    super(
      `Stack '${StackName}' cannot be updated when it has status ${StackStatus}: ${StackStatusReason}`,
    );
    this.stackDetails = stackDetails;
  }
}

export class InvalidCompleteStatusStackError extends DeployStackError {
  public stackDetails: CloudFormation.Stack;
  constructor(
    stackDetails: CloudFormation.Stack,
    type: "CREATE" | "UPDATE" | "DELETE",
  ) {
    const { StackName, StackStatus, StackStatusReason } = stackDetails;
    super(
      `Stack '${StackName}' failed to delete, it now has status ${StackStatus}: ${StackStatusReason}`,
    );
    this.stackDetails = stackDetails;
  }
}

export class ChangeSetNotAvailableError extends DeployStackError {
  public changeSetDetails: CloudFormation.ChangeSetSummary;
  constructor(changeSetDetails: CloudFormation.ChangeSetSummary) {
    const { ExecutionStatus, Status, StatusReason } = changeSetDetails;
    super(`\
Change set cannot be executed:
  execution status: ${ExecutionStatus}
  status: ${Status}
  reason: ${StatusReason}`);
    this.changeSetDetails = changeSetDetails;
  }
}

export interface Logger {
  log(format: string, ...args: any[]): void;
}

export type StackWaiterReason =
  | "DELETE_EXISTING"
  | "IN_PROGRESS_EXISTING"
  | "EXECUTING";

export interface StackWaiterContext {
  client: CloudFormation;
  reason: StackWaiterReason;
  stack: CloudFormation.Stack | null;
}

export interface StackWaiter {
  progress: (context: StackWaiterContext) => void | PromiseLike<void>;
  complete: (context: StackWaiterContext) => void | PromiseLike<void>;
}

export interface DeployStackOptions {
  logger?: Logger;
  prompt?: (message: string) => boolean | PromiseLike<boolean>;
  waiter?: StackWaiter;

  client: CloudFormation;
  templateBody: string;
  stackName: string;
  parameters?: CloudFormation.Parameters;
  capabilities?: CloudFormation.Capabilities;
  tags?: CloudFormation.Tags;
}

export default async function deployStack({
  logger = console,
  prompt = createPrompt(process.stdin, process.stdout),
  waiter,

  client,
  templateBody,
  stackName,
  parameters,
  capabilities,
  tags,
}: DeployStackOptions) {
  const type = await getChangeSetType();
  async function getChangeSetType(): Promise<"CREATE" | "UPDATE"> {
    const stack = await getStack();
    if (!stack || stack.StackStatus === "REVIEW_IN_PROGRESS") {
      logger.log("Stack does not exist, creating new...");
      return "CREATE";
    }

    if (stack.StackStatus === "DELETE_COMPLETE") {
      logger.log("Stack was deleted, creating new...");
      return "CREATE";
    }

    if (
      stack.StackStatus === "CREATE_FAILED" ||
      stack.StackStatus === "ROLLBACK_COMPLETE"
    ) {
      logger.log("Stack failed to create, replacing...");
      await client
        .deleteStack({
          StackName: stackName,
        })
        .promise();
      const stack = await waitUntilDone("DELETE_EXISTING");
      if (stack && stack.StackStatus !== "DELETE_COMPLETE") {
        throw new InvalidCompleteStatusStackError(stack, "DELETE");
      }
      return "CREATE";
    }

    if (stack.StackStatus.endsWith("_COMPLETE")) {
      logger.log(
        "Stack exists with status %O, updating existing...",
        stack.StackStatus,
      );
      return "UPDATE";
    }

    if (stack.StackStatus.endsWith("_IN_PROGRESS")) {
      logger.log(
        "Stack is in progress with status %O, waiting...",
        stack.StackStatus,
      );
      await waitUntilDone("IN_PROGRESS_EXISTING");
      return getChangeSetType();
    }

    throw new InvalidStatusBeforeUpdateStackError(stack);
  }

  // API quirk
  if (capabilities && capabilities.length === 0) {
    capabilities = undefined;
  }

  const changeSetName = `deploy-${new Date()
    .toISOString()
    .replace(/[^-\w]/g, "-")}`;
  const create = await client
    .createChangeSet({
      StackName: stackName,
      ChangeSetName: changeSetName,
      ChangeSetType: type,
      TemplateBody: templateBody,
      Parameters: parameters,
      Capabilities: capabilities,
      Tags: tags,
    })
    .promise();

  logger.log("Created change set %O", create.Id);
  const reviewUrlParams = new URLSearchParams({
    changeSetId: create.Id,
    stackId: create.StackId,
  });
  logger.log(
    "Review at %s",
    `https://${
      client.config.region
    }.console.aws.amazon.com/cloudformation/home?region=${
      client.config.region
    }#/changeset/detail?${reviewUrlParams}`,
  );

  let changeSet;
  do {
    await sleep(1000);
    changeSet = await client
      .describeChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
      })
      .promise();
  } while (changeSet.Status === "CREATE_IN_PROGRESS");

  if (changeSet.ExecutionStatus !== "AVAILABLE") {
    if (
      changeSet.Status === "FAILED" &&
      changeSet.StatusReason ===
        "The submitted information didn't contain changes. Submit different information to create a change set."
    ) {
      logger.log("No changes");
      await deleteChangeSet();
    } else {
      throw new ChangeSetNotAvailableError(changeSet);
    }
    return;
  }

  logger.log("Changes:\n%O", changeSet.Changes);

  if (!(await prompt("Deploy?"))) {
    await deleteChangeSet();
    return;
  }

  logger.log("Executing change set...");
  await client
    .executeChangeSet({
      StackName: stackName,
      ChangeSetName: changeSetName,
    })
    .promise();

  {
    const stack = (await waitUntilDone("EXECUTING"))!;
    if (stack.StackStatus !== `${type}_COMPLETE`) {
      throw new InvalidCompleteStatusStackError(stack, type);
    }

    if (stack.Outputs && stack.Outputs.length) {
      logger.log("Outputs:");
      for (const output of stack.Outputs) {
        logger.log("  %O: %O", output.OutputKey, output.OutputValue);
      }
    }
  }

  async function deleteChangeSet() {
    logger.log("Deleting change set...");
    await client
      .deleteChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
      })
      .promise();
  }

  async function waitUntilDone(reason: StackWaiterReason) {
    let stack;
    do {
      await sleep(2000);
      stack = await getStack();
      if (waiter) await waiter.progress({ client, reason, stack });
    } while (stack && stack.StackStatus.endsWith("_IN_PROGRESS"));
    if (waiter) await waiter.complete({ client, reason, stack });
    return stack;
  }

  async function getStack() {
    try {
      const res = await client
        .describeStacks({ StackName: stackName })
        .promise();
      return res.Stacks![0];
    } catch (e) {
      if (
        e &&
        e.code === "ValidationError" &&
        e.message === `Stack with id ${stackName} does not exist`
      ) {
        return null;
      }
      throw e;
    }
  }
}

export function createPrompt(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
): (message: string) => Promise<boolean> {
  if (!stdin.isTTY) {
    return () => Promise.resolve(true);
  }

  return async (message: string) => {
    stdout.write(`${message} [Y/n] `);
    const key = await getKey();
    stdout.write("\n");
    return key === "y";
  };
}

export async function getKey(stdin = process.stdin) {
  let key;
  let paused = stdin.isPaused();
  try {
    stdin.setRawMode!(true);
    key = await new Promise<Buffer>(resolve => {
      stdin.once("data", resolve);
    });
    if (paused) stdin.resume();
  } finally {
    if (paused) stdin.pause();
    stdin.setRawMode!(false);
  }
  return key.toString();
}
