#!/usr/bin/env node
import * as CloudFormation from "aws-sdk/clients/cloudformation";
import * as AWS from "aws-sdk/global";
import * as fs from "fs";
import { createTableWaiter } from "./createTableWaiter";

import deployStack, {
  DeployStackError,
} from "./deployStack";

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
Usage: deploy-stack \\
    [credential options] \\
    --region REGION \\
    --stack-name NAME \\
    --template-path PATH \\
    [additional options] \\
    [template parameters]

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

  const profile = getStringOption(options, "profile", null);
  const accessKeyId = getStringOption(options, "access-key-id", null);
  const secretAccessKey = getStringOption(options, "secret-access-key", null);

  const region = getStringOption(options, "region");

  const stackName = getStringOption(options, "stack-name");
  const templatePath = getStringOption(options, "template-path");

  const capabilities = getStringOption(options, "capabilities", "").split(",");

  const tags: CloudFormation.Tags = [];
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

  const parameters: CloudFormation.Parameters = [];
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

  let credentials: AWS.Credentials | undefined;
  if (profile !== null) {
    credentials = new AWS.SharedIniFileCredentials({ profile });
  }
  if (accessKeyId || secretAccessKey) {
    if (!accessKeyId || !secretAccessKey) {
      throw new OptionError(
        "Must pass both --access-key-id and --secret-access-key if one is used",
      );
    }
    credentials = new AWS.Credentials({ accessKeyId, secretAccessKey });
  }

  if (!fs.existsSync(templatePath)) {
    throw new OptionError("Template path does not exist: " + templatePath);
  }

  const client = new CloudFormation({ region, credentials });

  await deployStack({
    waiter: createTableWaiter(),
    client,
    templateBody: fs.readFileSync(templatePath, "utf-8"),
    stackName,
    parameters,
    capabilities,
    tags,
  });
}

if (require.main === module) {
  main(parseOptions()).then(
    () => {
      console.log("Done");
      // Not sure what's keeping it running...
      process.exit(0);
    },
    error => {
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
    },
  );
}
