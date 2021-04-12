import * as cdk from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import * as dotenv from "dotenv";
dotenv.config();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
const accountName = process.env.CDK_DEFAULT_ACCOUNT_NAME;
const prefix = process.env.PREFIX;
//    //const eventRole = iam.Role.fromRoleArn(this, "codePipelineRole", `arn:aws-us-gov:iam::${account}:role/CodePipelineManagedPolicy`);

//const eventRole = iam.Role.fromRoleArn(this, "codePipelineRole", `arn:aws-us-gov:iam::${account}:role/CodePipelineManagedPolicy`);

export class IAMStack extends cdk.Stack {
  constructor(app: cdk.App, id: string, props?: cdk.StackProps) {
    super(app, id, props);

    // ECS Task Trust Role
    const ecsTaskRole = new iam.Role(this, `${prefix}-ECSTasks-Role`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), // required
      roleName: `${prefix}-ECSTasks-Role`,
    });

    ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["ecr:*", "secrets:*"],
      })
    );

    ecsTaskRole.addManagedPolicy({ managedPolicyArn: "arn:aws-us-gov:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" });
    ecsTaskRole.addManagedPolicy({ managedPolicyArn: "arn:aws-us-gov:iam::aws:policy/AmazonECS_FullAccess" });
    ecsTaskRole.addManagedPolicy({ managedPolicyArn: "arn:aws-us-gov:iam::aws:policy/SecretsManagerReadWrite" });

    //Create CodeBuild Project IAM Role
    const projectRole = new iam.Role(this, `${prefix}-CodeBuild-Project-Role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"), // required
      roleName: `${prefix}-CodeBuild-Project-Role`,
    });

    projectRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["codecommit:*", "codebuild:*", "codepipeline:*", "logs:*", "s3:*", "kms:*", "ecr:*"],
      })
    );

    //Create Pipeline Project IAM Role
    const assumedRole = new iam.Role(this, `${prefix}-Pipeline-Assumed-Principal-Role`, {
      assumedBy: new iam.AccountPrincipal(`${account}`), // required
      roleName: `${prefix}-Pipeline-Assumed-Principal-Role`,
    });

    assumedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["codecommit:*", "codebuild:*", "codepipeline:*", "logs:*", "s3:*", "kms:*", "ecr:*"],
      })
    );

    const pipelineRole = new iam.Role(this, `${prefix}-Pipeline-Role`, {
      assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"), // required
      roleName: `${prefix}-Pipeline-Role`,
    });

    pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["codecommit:*", "codebuild:*", "codepipeline:*", "logs:*", "s3:*", "kms:*", "ecr:*"],
      })
    );

    pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [assumedRole.roleArn, projectRole.roleArn],
        actions: ["sts:AssumeRole"],
      })
    );
  }
}

/**
 * const DenyDelete = new iam.CfnManagedPolicy(this, `DenyCodeCommitDeleteBranch`, {
      managedPolicyName: `DenyCodeCommitDeleteBranch`,
      path: "/",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Deny",
            Action: ["codecommit:DeleteBranch"],
            Resource: [
              `arn:aws-us-gov:codecommit:${region}:${accountID}:cybereval-api`,
              `arn:aws-us-gov:codecommit:${region}:${accountID}:cybereval-web`,
              `arn:aws-us-gov:codecommit:${region}:${accountID}:cybereval-idp`,
            ],
            Condition: {
              StringEqualsIfExists: {
                "codecommit:References": ["refs/heads/dev", "refs/heads/master"],
              },
              Null: {
                "codecommit:References": false,
              },
            },
          },
        ],
      },
    });

    const AWSServiceRoleForECS = new iam.Role(this, "AWSServiceRoleForECS", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"), // required
      roleName: "AWSServiceRoleForECS",
    });

    AWSServiceRoleForECS.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "iam:CreateServiceLinkedRole",
          "ec2:*",
          "elasticloadbalancing:*",
          "route53:*",
          "servicediscovery:*",
          "autoscaling:*",
          "autoscaling-plans:*",
          "cloudwatch:*",
          "logs:*",
        ],
      })
    );
 */
