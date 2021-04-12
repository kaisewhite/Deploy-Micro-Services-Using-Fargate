# Welcome to your CDK TypeScript project!

This is a blank project for TypeScript development with CDK.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
- `cdk synth --profile jacobs_sandbox && cdk deploy --profile jacobs_sandbox --all --require-approval never` synth and deploy
- `cat ~/.aws/credentials` look up configured aws credentials

## Resource Checklist

ECR Repositories (3x)
ECS Clusters (3x)
ECS Services (9x)
Task Definitions (9x)
CodePipelines (9x)
CloudWatch logGroups (All Containers and CodeBuild Projects)
Application Load Balancers (2x - Prod & NonProd)
Target Groups (9x - One Target Group Per ECS Service)
Listeners (2 per ALB - Auto Redirect to 443)
Security Groups (1x) - Need to make two. Non & NonProd
Host based routing rules (9x)
HealthChecks (All ECS Tasks)
ImageDef.json deployed to Master & Dev Branches
Route53 A Records in Moderate Env Updated
Secrets - NOT STARTED
