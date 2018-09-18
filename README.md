# NPM `@simonbuchan/deploy-stack`

Deploys AWS CloudFormation stacks.

## Justification

There are many NPM packages for nicely deploying AWS CloudFormation, and they
already work well. Why add another?

Well, I wanted:

- A programmatic API
- Use of Change Sets, to allow the user to review the changes they are about to
  make.
- Live progress output, so any errors can be quickly resolved.
- Nicer behavior around some of the more unusual stack states, e.g.
  `REVIEW_IN_PROGRESS`, `ROLLBACK_COMPLETE`, all `*_IN_PROGRESS` states.

There's still plenty of things that could be added to this, but this works for
me for now!

## Not implemented (yet?)

- Prevent rollback on failure (doesn't seem to be an option for change sets?)
- Template upload / URL support, needed for very large templates
- Reuse previous template / parameter values.
- Customizing refresh rate (5 seconds should work for anybody?)
- Less ugly output tables 😅

## API Usage

Built in typescript, so you should get a good experience in editors that support
.d.ts typings (even in Javascript).

```js
import AWS from "aws-sdk/global";
import CloudFormation from "aws-sdk/clients/cloudformation";
import deployStack from "@simonbuchan/deploy-stack";

deployStack({
  // Required:
  client: new CloudFormation({
    region: "us-east-1",
    credentials: new AWS.SharedIniFileCredentials({ profile: "test" }),
  }),
  stackName: "my-app",
  templateBody: fs.readFileSync("my-app.yaml"),

  // Optional:
  logger: console,
  prompt: (message) => {
    // Prompt the user for if they want to execute the change set,
    // Return a promise for a boolean.
  },
  waiter: {
    progress({ client, reason, stack }) {
      // client is the outer client.
      // reason is one of:
      //   - 'DELETING_EXISTING':
      //     Removing a dead existing stack: e.g.
      //     ROLLBACK_COMPLETE, CREATE_FAILED
      //   - 'IN_PROGRESS_EXISTING':
      //     Waiting for a currently *_IN_PROGRESS
      //     stack to complete before attempting to
      //     create a change set.
      //   - 'EXECUTING':
      //     Actually applying current stack.
      //
      // Can return a promise (e.g. be async)
      // and it will block the stack polling loop
      // so you don't overlap.
    },
    async complete({ client, reason, stack }) {
      // same as above ...
    },
  },
  parameters: [
    {
      ParameterKey: "DomainName",
      ParameterValue: "my-app",
    },
  ],
  tags: [
    {
      Key: "app",
      Value: "my-app",
    },
  ],
})
  .then
  // ...
  ();
```

## CLI Usage

From `deploy-stack --help`:

```
Usage: deploy-stack \
    [credential options] \
    --region REGION \
    --stack-name NAME \
    --template-path PATH \
    [additional options] \
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

    deploy-stack \
        --profile test \
        --region us-east-1 \
        --stack-name my-app-dev \
        --template-path my-app.yaml \
        --tag:app my-app \
        DomainName=my-app.example.test
```
