#!/usr/bin/env node
import * as fs from "node:fs";

import * as AWS from "@aws-sdk/types";
import * as CloudFormation from "@aws-sdk/client-cloudformation";
import * as Credentials from "@aws-sdk/credential-providers";

import deployStack, {
  DeployStackError,
  createTableWaiter,
  createEventLogWaiter,
} from "./";

import {
  argsSymbol,
  checkForUnknownOptions,
  getFlagOption,
  getStringOption,
  OptionError,
  Options,
  parseOptions,
} from "./options";

const helpMessage = `\
Usage:
  deploy-stack \\
    [credential options] \\
    --region REGION \\
    --stack-name NAME \\
    --template-path PATH \\
    [additional options] \\
    [template parameters]

  deploy-stack --help

  deploy-stack --version


Credential options:
   [--profile NAME]                    # Profile name in ~/.aws/credentials
   [--access-key-id KEY_ID             # Explicit access key id
    --secret-access-key SECRET]        # Secret access key

    By default, the standard AWS SDK fallback logic is used, that is:
    $AWS_* environment variables, then ~/.aws/credentials, then EC2 Instance
    profile.


Required options:
    --region REGION                    # AWS region to create stack in
    --stack-name NAME                  # CloudFormation stack name to create
    --template-path PATH               # Path to CloudFormation stack template
                                       # file. (YAML or JSON)

Additional options:
   [--capabilities NAME,NAME,...]      # CloudFormation capabilities to add.
                                       # Use "," to join multiple.
                                       # Valid values are currently:
                                       #   CAPABILITY_IAM
                                       #   CAPABILITY_NAMED_IAM
   [--tag:NAME VALUE]...               # Tags to add to all created resources
                                       # e.g.:
                                       # --tag:env dev --tag:team sales

Template parameters:
    NAME=VALUE                         # Adds a value for a CloudFormation
                                       # template parameter

Example:

    deploy-stack \\
        --profile test \\
        --region us-east-1 \\
        --stack-name my-app-dev \\
        --template-path my-app.yaml \\
        --tag:app my-app \\
        DomainName=my-app.example.test
`;

async function main(options: Options) {
  if (getFlagOption(options, "help")) {
    console.log(helpMessage);
    return;
  }

  if (getFlagOption(options, "version")) {
    console.log(require("../package.json").version);
    return;
  }

  const profile = getStringOption(options, "profile", null);
  const accessKeyId = getStringOption(options, "access-key-id", null);
  const secretAccessKey = getStringOption(options, "secret-access-key", null);

  const region = getStringOption(options, "region");

  const stackName = getStringOption(options, "stack-name");
  const templatePath = getStringOption(options, "template-path");

  const capabilitiesString = getStringOption(options, "capabilities", null);
  const capabilities =
    capabilitiesString !== null ? capabilitiesString.split(",") : undefined;

  const tags: CloudFormation.Tag[] = [];
  for (const name of Object.keys(options)) {
    const match = name.match(/^tag:(.*)$/);
    if (match) {
      const value = options[name];
      if (value === true) {
        throw new OptionError(`--${name} requires a value`);
      }
      tags.push({ Key: match[1], Value: value });
      delete options[name];
    }
  }

  const parameters: CloudFormation.Parameter[] = [];
  const args = options[argsSymbol];
  while (args.length) {
    const arg = args[0];
    const match = arg.match(/^(\w+)=(.+)$/);
    if (match) {
      args.shift();
      parameters.push({
        ParameterKey: match[1],
        ParameterValue: match[2],
      });
    }
  }

  checkForUnknownOptions(options);

  if (capabilities) {
    assertAll(capabilities, assertCapability);
  }

  let credentials: AWS.CredentialProvider | undefined;
  if (profile !== null) {
    if (accessKeyId) {
      throw new OptionError(
        "Must pass only one of --profile or --access-key-id",
      );
    }
    credentials = Credentials.fromIni({ profile });
  } else if (accessKeyId || secretAccessKey) {
    if (!accessKeyId || !secretAccessKey) {
      throw new OptionError(
        "Must pass both --access-key-id and --secret-access-key if one is used",
      );
    }
    credentials = async () => ({ accessKeyId, secretAccessKey });
  }

  if (!fs.existsSync(templatePath)) {
    throw new OptionError("Template path does not exist: " + templatePath);
  }

  const waiter = process.stdin.isTTY
    ? createTableWaiter()
    : createEventLogWaiter();

  const client = new CloudFormation.CloudFormationClient({
    region,
    credentials,
  });

  await deployStack({
    waiter,
    client,
    templateBody: fs.readFileSync(templatePath, "utf-8"),
    stackName,
    parameters,
    capabilities,
    tags,
  });

  console.log("Done");
  // Not sure what's keeping it running...
  process.exit(0);
}

function assertAll<T, R extends T>(
  array: T[],
  assert: (item: T) => asserts item is R,
): asserts array is R[] {
  for (const item of array) {
    assert(item);
  }
}

function assertCapability(
  value: string,
): asserts value is CloudFormation.Capability {
  if (!Object.prototype.hasOwnProperty.call(CloudFormation.Capability, value)) {
    throw new OptionError(
      `--capability not valid: ${value}. Must be one of: ${Object.keys(
        CloudFormation.Capability,
      ).join(", ")}`,
    );
  }
}

if (require.main === module) {
  main(parseOptions()).catch((error) => {
    if (error instanceof OptionError) {
      console.error(error.message);
      process.exit(2);
    } else if (error instanceof DeployStackError) {
      console.error(error.message);
      process.exit(3);
    } else {
      console.error(error.stack);
      process.exit(1);
    }
  });
}
