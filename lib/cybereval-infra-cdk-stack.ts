import * as cdk from "@aws-cdk/core";
import { APIPipelineStack, IDPPipelineStack, WebPipelineStack } from "../pipelines/index";
import { ECRStack } from "../stacks/ECR/index";
import { ECSClusterStack } from "../stacks/ECS/clusters";
import { ECSServicesStack } from "../stacks/ECS/services";
import { EC2ResourceStack } from "../stacks/EC2/index";
import { IAMStack } from "../stacks/IAM/index";
import { App } from "@aws-cdk/core";
import * as dotenv from "dotenv";
import { ElasticacheStack } from "../stacks/Elasticache/index";
dotenv.config();

const app = new App();
const stackPrefix = process.env.CDK_STACK_NAME;
const vpcID =
  process.env.CDK_DEFAULT_ACCOUNT === "111055882567" ? "vpc-08460d5edf75ac7e5" : process.env.CDK_DEFAULT_ACCOUNT === "936867263904" ? "vpc-95bf09f1" : "";

export class CyberevalInfraCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const IAM = new IAMStack(app, `${stackPrefix}-IAM`, {
      description: "Creates IAM Roles and Managed Policies",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });

    const Elasticache = new ElasticacheStack(app, `${stackPrefix}-Redis`, {
      vpcID: vpcID,
      prefix: "CyberEval",
      description: "Create Redis Cluster",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });
    const ECR = new ECRStack(app, `${stackPrefix}-ECR`, {
      repos: ["cybereval-api", "cybereval-web", "cybereval-idp"],
      description: "Create Elastic Container Repositories",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });
    const ECSCluster = new ECSClusterStack(app, `${stackPrefix}-ECS-Clusters`, {
      vpcID: vpcID,
      prefix: "CyberEval",
      environments: ["Dev", "Prod"],
      description: "Creates ECS Clusters for Dev, Stag and Prod for CyberEval",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });

    const ECSServices = new ECSServicesStack(app, `${stackPrefix}-ECS-Services`, {
      vpcID: vpcID,
      environments: ["Dev", "Prod"],
      prefix: "CyberEval",
      description: "Creates Task Definitions, ECS Services, ALB's, Listners, and Actions",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });

    const APIPipeline = new APIPipelineStack(app, `${stackPrefix}-API-Pipeline`, {
      vpcID: vpcID,
      repositoryName: "CyberEval-API",
      environments: ["Dev", "Prod"], // Dev, Stag, Prod
      prefix: "CyberEval",
      service: "CyberEval-API",
      description: "Creates the pipeline architecture for CyberEval API - Dev, Staging & Prod Pipelines",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });

    const IDPPipeline = new IDPPipelineStack(app, `${stackPrefix}-IDP-Pipeline`, {
      vpcID: vpcID,
      repositoryName: "CyberEval-IdP",
      environments: ["Dev", "Prod"], // Dev, Stag, Prod
      prefix: "CyberEval",
      service: "CyberEval-IDP",
      description: "Creates the pipeline architecture for CyberEval IDP - Dev, Staging & Prod Pipelines",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });

    const WebPipeline = new WebPipelineStack(app, `${stackPrefix}-Web-Pipeline`, {
      vpcID: vpcID,
      repositoryName: "CyberEval-Web",
      environments: ["Dev", "Prod"], // Dev, Stag, Prod
      prefix: "CyberEval",
      service: "CyberEval-Web",
      description: "Creates the pipeline architecture for CyberEval Web - Dev, Staging & Prod Pipelines",
      env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    });

    //Define the creation order by creating dependencies on other stacks
    ECR.addDependency(IAM);
    ECSServices.addDependency(ECR);
    ECSServices.addDependency(APIPipeline);
    ECSServices.addDependency(WebPipeline);
    ECSServices.addDependency(IDPPipeline);
    Elasticache.addDependency(IAM);
  }
}
