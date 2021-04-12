import * as codebuild from "@aws-cdk/aws-codebuild";
import * as codecommit from "@aws-cdk/aws-codecommit";
import * as codepipeline from "@aws-cdk/aws-codepipeline";
import * as codepipeline_actions from "@aws-cdk/aws-codepipeline-actions";
import { BitBucketSourceAction } from "@aws-cdk/aws-codepipeline-actions";
import * as awslogs from "@aws-cdk/aws-logs";
import { App, Duration, Stack, StackProps } from "@aws-cdk/core";
import { SimpleSynthAction, CdkPipeline } from "@aws-cdk/pipelines";
import * as iam from "@aws-cdk/aws-iam";
import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as s3 from "@aws-cdk/aws-s3";

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

export interface PipelineStackProps extends StackProps {
  readonly repositoryName: string;
  readonly environments: string[];
  readonly prefix: string;
  readonly service: string;
  readonly vpcID: string;
}

export class APIPipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const envs = props.environments;
    const prefix = props.prefix;
    const service = props.service;

    const repository = codecommit.Repository.fromRepositoryName(this, "ImportedRepo", props.repositoryName);
    const ExistingVpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    //const sourceOutput = new codepipeline.Artifact();
    //const buildOutput = new codepipeline.Artifact();
    const sourceArtifact = new codepipeline.Artifact();

    const projectRole = iam.Role.fromRoleArn(this, "projectRole", `arn:aws-us-gov:iam::${account}:role/CyberEval-CodeBuild-Project-Role`);
    const pipelineRole = iam.Role.fromRoleArn(this, "pipelineRole", `arn:aws-us-gov:iam::${account}:role/CyberEval-Pipeline-Role`);

    /**
     * Foreach loop will create a new pipeline per environment
     */
    envs.forEach((env) => {
      const branch = env === "Dev" ? "dev" : env === "Stag" ? "master" : env === "Prod" ? "master" : "dev";
      const retention = env === "Prod" ? awslogs.RetentionDays.INFINITE : awslogs.RetentionDays.TWO_WEEKS;
      const fargateCluster = ecs.Cluster.fromClusterAttributes(this, `Imported-${service}-API-Cluster-${env}`, {
        clusterName: `${prefix}-${env}`,
        vpc: ExistingVpc,
        securityGroups: [],
      });

      const fargateService = ecs.FargateService.fromFargateServiceAttributes(this, `Imported-${service}-${env}-Service`, {
        cluster: fargateCluster,
        serviceName: `${service}-${env}`,
      });
      //S3 Artifact Bucket
      const artifactBucket = new s3.Bucket(this, `CyberEval-API-Pipeline-${env}-Artifact-Bucket`, {
        bucketName: `${service.toString().toLowerCase()}-${env.toString().toLowerCase()}-artifacts`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.KMS_MANAGED,
        publicReadAccess: false,
        lifecycleRules: [
          {
            expiration: Duration.days(7),
          },
        ],
      });

      artifactBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: [artifactBucket.arnForObjects("*"), artifactBucket.bucketArn],
          actions: ["s3:*"],
          principals: [new iam.ArnPrincipal(pipelineRole.roleArn)],
        })
      );
      //Create codebuild project
      const project = new codebuild.Project(this, `cybereval-project-api-${env}`, {
        source: codebuild.Source.codeCommit({ repository }),
        role: projectRole,
        projectName: `CyberEval-API-${env}`,
        description: `Build Project for CyberEval API ${env}`,
        artifacts: codebuild.Artifacts.s3({
          bucket: artifactBucket,
          includeBuildId: false,
          packageZip: true,
          path: "**/*",
          identifier: `Artifact-${env}`,
        }),
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            pre_build: {
              commands: [
                "echo Logging in to Amazon ECR...",
                "aws --version",
                "$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)",
                `REPOSITORY_URI=${account}.dkr.ecr.${region}.amazonaws.com/cybereval-api`,
                "COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)",
                `IMAGE_TAG=\${COMMIT_HASH:=${env}}`,
              ],
            },
            build: {
              commands: [
                "echo Build started on `date`",
                "echo Building the Docker image...",
                `docker build -f CyberEval.Api/Dockerfile -t $REPOSITORY_URI:${env} .`,
                `docker tag $REPOSITORY_URI:${env} $REPOSITORY_URI:$IMAGE_TAG`,
              ],
            },
            post_build: {
              commands: [
                "echo Build completed on `date`",
                "echo Pushing the Docker images...",
                `docker push $REPOSITORY_URI:${env}`,
                "docker push $REPOSITORY_URI:$IMAGE_TAG",
              ],
            },
          },
        }),
        environment: { computeType: codebuild.ComputeType.SMALL, buildImage: codebuild.LinuxBuildImage.STANDARD_2_0, privileged: true },
        logging: {
          cloudWatch: {
            logGroup: new awslogs.LogGroup(this, `CyberEval-API-${env}-CodeBuild-LogGroup`, {
              logGroupName: `codebuild/cybereval-api-${env.toString().toLowerCase()}`,
              retention: retention,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
          },
        },
        timeout: Duration.minutes(15),
        badge: false,
      });

      //Create Source stage
      const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
        actionName: "CodeCommit",
        repository: repository,
        branch: branch,
        output: sourceArtifact,
        //output: sourceOutput,
        role: pipelineRole,
      });

      //Create second stage in pipeline which will be codebuild action
      const buildAction = new codepipeline_actions.CodeBuildAction({
        actionName: "CodeBuild",
        role: pipelineRole,
        project,
        input: sourceArtifact,
        //input: sourceOutput, // The build action must use the CodeCommitSourceAction output as input.
        //outputs: [buildOutput], // optional
      });
      //Create Manual Approval Action
      const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
        actionName: "Approve",
        role: pipelineRole,
      });

      const deployActionRolling = new codepipeline_actions.EcsDeployAction({
        actionName: "DeployAction",
        service: fargateService,
        deploymentTimeout: cdk.Duration.minutes(60),
        role: pipelineRole,
        imageFile: sourceArtifact.atPath(`imageDef-${env}.json`),
      });

      /**
       * Build Stage Object. If the env === Dev then the build stage will only include a build action
       * if the env === Staging or Prod then we will include the manual approval stage in the build action
       */
      const buildStage = env === "Dev" ? [buildAction] : [manualApprovalAction, buildAction];
      const deployStage = env === "Dev" ? [deployActionRolling] : [manualApprovalAction, deployActionRolling];

      //Create code pipeline with stages
      new codepipeline.Pipeline(this, `CyberEval-API-Pipeline-${env}`, {
        pipelineName: `CyberEval-API-${env}`,
        artifactBucket: artifactBucket,
        role: pipelineRole,
        stages: [
          {
            stageName: "Source",
            actions: [sourceAction],
          },
          {
            stageName: "Build",
            actions: [buildAction],
          },
          {
            stageName: "Deploy",
            actions: deployStage,
          },
        ],
      });
    });
  }
}

export class IDPPipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const envs = props.environments;
    const prefix = props.prefix;
    const service = props.service;

    const repository = codecommit.Repository.fromRepositoryName(this, "ImportedRepo", props.repositoryName);
    const ExistingVpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    const sourceArtifact = new codepipeline.Artifact();

    const projectRole = iam.Role.fromRoleArn(this, "projectRole", `arn:aws-us-gov:iam::${account}:role/CyberEval-CodeBuild-Project-Role`);
    const pipelineRole = iam.Role.fromRoleArn(this, "pipelineRole", `arn:aws-us-gov:iam::${account}:role/CyberEval-Pipeline-Role`);

    /**
     * Foreach loop will create a new pipeline per environment
     */
    envs.forEach((env) => {
      const branch = env === "Dev" ? "dev" : env === "Stag" ? "master" : env === "Prod" ? "master" : "dev";
      const retention = env === "Prod" ? awslogs.RetentionDays.INFINITE : awslogs.RetentionDays.TWO_WEEKS;
      const fargateCluster = ecs.Cluster.fromClusterAttributes(this, `Imported-${service}-IDP-Cluster-${env}`, {
        clusterName: `${prefix}-${env}`,
        vpc: ExistingVpc,
        securityGroups: [],
      });

      const fargateService = ecs.FargateService.fromFargateServiceAttributes(this, `Imported-${service}-${env}-Service`, {
        cluster: fargateCluster,
        serviceName: `${service}-${env}`,
      });
      //S3 Artifact Bucket
      const artifactBucket = new s3.Bucket(this, `CyberEval-IDP-Pipeline-${env}-Artifact-Bucket`, {
        bucketName: `${service.toString().toLowerCase()}-${env.toString().toLowerCase()}-artifacts`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.KMS_MANAGED,
        publicReadAccess: false,
        lifecycleRules: [
          {
            expiration: Duration.days(7),
          },
        ],
      });

      artifactBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: [artifactBucket.arnForObjects("*"), artifactBucket.bucketArn],
          actions: ["s3:*"],
          principals: [new iam.ArnPrincipal(pipelineRole.roleArn)],
        })
      );
      //Create codebuild project
      const project = new codebuild.Project(this, `cybereval-project-IDP-${env}`, {
        source: codebuild.Source.codeCommit({ repository }),
        role: projectRole,
        projectName: `CyberEval-IDP-${env}`,
        description: `Build Project for CyberEval IDP ${env}`,
        artifacts: codebuild.Artifacts.s3({
          bucket: artifactBucket,
          includeBuildId: false,
          packageZip: true,
          path: "**/*",
          identifier: `Artifact-${env}`,
        }),
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            pre_build: {
              commands: [
                "echo Logging in to Amazon ECR...",
                "aws --version",
                "$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)",
                `REPOSITORY_URI=${account}.dkr.ecr.${region}.amazonaws.com/cybereval-idp`,
                "COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)",
                `IMAGE_TAG=\${COMMIT_HASH:=${env}}`,
              ],
            },
            build: {
              commands: [
                "echo Build started on `date`",
                "echo Building the Docker image...",
                `docker build -t $REPOSITORY_URI:${env} .`,
                `docker tag $REPOSITORY_URI:${env} $REPOSITORY_URI:$IMAGE_TAG`,
              ],
            },
            post_build: {
              commands: [
                "echo Build completed on `date`",
                "echo Pushing the Docker images...",
                `docker push $REPOSITORY_URI:${env}`,
                "docker push $REPOSITORY_URI:$IMAGE_TAG",
              ],
            },
          },
        }),
        environment: { computeType: codebuild.ComputeType.SMALL, buildImage: codebuild.LinuxBuildImage.STANDARD_2_0, privileged: true },
        logging: {
          cloudWatch: {
            logGroup: new awslogs.LogGroup(this, `CyberEval-IDP-${env}-CodeBuild-LogGroup`, {
              logGroupName: `codebuild/cybereval-IDP-${env.toString().toLowerCase()}`,
              retention: retention,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
          },
        },
        timeout: Duration.minutes(15),
        badge: false,
      });

      //Create Source stage
      const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
        actionName: "CodeCommit",
        repository: repository,
        branch: branch,
        output: sourceArtifact,
        //output: sourceOutput,
        role: pipelineRole,
      });

      //Create second stage in pipeline which will be codebuild action
      const buildAction = new codepipeline_actions.CodeBuildAction({
        actionName: "CodeBuild",
        role: pipelineRole,
        project,
        input: sourceArtifact,
        //input: sourceOutput, // The build action must use the CodeCommitSourceAction output as input.
        //outputs: [buildOutput], // optional
      });
      //Create Manual Approval Action
      const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
        actionName: "Approve",
        role: pipelineRole,
      });

      const deployActionRolling = new codepipeline_actions.EcsDeployAction({
        actionName: "DeployAction",
        service: fargateService,
        deploymentTimeout: cdk.Duration.minutes(60),
        role: pipelineRole,
        imageFile: sourceArtifact.atPath(`imageDef-${env}.json`),
      });

      /**
       * Build Stage Object. If the env === Dev then the build stage will only include a build action
       * if the env === Staging or Prod then we will include the manual approval stage in the build action
       */
      const buildStage = env === "Dev" ? [buildAction] : [manualApprovalAction, buildAction];
      const deployStage = env === "Dev" ? [deployActionRolling] : [manualApprovalAction, deployActionRolling];

      //Create code pipeline with stages
      new codepipeline.Pipeline(this, `CyberEval-IDP-Pipeline-${env}`, {
        pipelineName: `CyberEval-IDP-${env}`,
        artifactBucket: artifactBucket,
        role: pipelineRole,
        stages: [
          {
            stageName: "Source",
            actions: [sourceAction],
          },
          {
            stageName: "Build",
            actions: [buildAction],
          },
          {
            stageName: "Deploy",
            actions: deployStage,
          },
        ],
      });
    });
  }
}

export class WebPipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const envs = props.environments;
    const prefix = props.prefix;
    const service = props.service;

    const repository = codecommit.Repository.fromRepositoryName(this, "ImportedRepo", props.repositoryName);
    const ExistingVpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    //const sourceOutput = new codepipeline.Artifact();
    //const buildOutput = new codepipeline.Artifact();
    const sourceArtifact = new codepipeline.Artifact();

    const projectRole = iam.Role.fromRoleArn(this, "projectRole", `arn:aws-us-gov:iam::${account}:role/CyberEval-CodeBuild-Project-Role`);
    const pipelineRole = iam.Role.fromRoleArn(this, "pipelineRole", `arn:aws-us-gov:iam::${account}:role/CyberEval-Pipeline-Role`);

    /**
     * Foreach loop will create a new pipeline per environment
     */
    envs.forEach((env) => {
      const branch = env === "Dev" ? "dev" : env === "Stag" ? "master" : env === "Prod" ? "master" : "dev";
      const retention = env === "Prod" ? awslogs.RetentionDays.INFINITE : awslogs.RetentionDays.TWO_WEEKS;
      const fargateCluster = ecs.Cluster.fromClusterAttributes(this, `Imported-${service}-Web-Cluster-${env}`, {
        clusterName: `${prefix}-${env}`,
        vpc: ExistingVpc,
        securityGroups: [],
      });

      const fargateService = ecs.FargateService.fromFargateServiceAttributes(this, `Imported-${service}-${env}-Service`, {
        cluster: fargateCluster,
        serviceName: `${service}-${env}`,
      });
      //S3 Artifact Bucket
      const artifactBucket = new s3.Bucket(this, `CyberEval-Web-Pipeline-${env}-Artifact-Bucket`, {
        bucketName: `${service.toString().toLowerCase()}-${env.toString().toLowerCase()}-artifacts`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.KMS_MANAGED,
        publicReadAccess: false,
        lifecycleRules: [
          {
            expiration: Duration.days(7),
          },
        ],
      });

      artifactBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: [artifactBucket.arnForObjects("*"), artifactBucket.bucketArn],
          actions: ["s3:*"],
          principals: [new iam.ArnPrincipal(pipelineRole.roleArn)],
        })
      );
      //Create codebuild project
      const project = new codebuild.Project(this, `cybereval-project-Web-${env}`, {
        source: codebuild.Source.codeCommit({ repository }),
        role: projectRole,
        projectName: `CyberEval-Web-${env}`,
        description: `Build Project for CyberEval Web ${env}`,
        artifacts: codebuild.Artifacts.s3({
          bucket: artifactBucket,
          includeBuildId: false,
          packageZip: true,
          path: "**/*",
          identifier: `Artifact-${env}`,
        }),
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            pre_build: {
              commands: [
                "echo Logging in to Amazon ECR...",
                "aws --version",
                "$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)",
                `REPOSITORY_URI=${account}.dkr.ecr.${region}.amazonaws.com/cybereval-web`,
                "COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)",
                `IMAGE_TAG=\${COMMIT_HASH:=${env}}`,
              ],
            },
            build: {
              commands: [
                "echo Build started on `date`",
                "echo Building the Docker image...",
                `docker build -f CyberEval.WebApp.Server/Dockerfile -t $REPOSITORY_URI:${env} .`,
                `docker tag $REPOSITORY_URI:${env} $REPOSITORY_URI:$IMAGE_TAG`,
              ],
            },
            post_build: {
              commands: [
                "echo Build completed on `date`",
                "echo Pushing the Docker images...",
                `docker push $REPOSITORY_URI:${env}`,
                "docker push $REPOSITORY_URI:$IMAGE_TAG",
              ],
            },
          },
        }),
        environment: { computeType: codebuild.ComputeType.SMALL, buildImage: codebuild.LinuxBuildImage.STANDARD_2_0, privileged: true },
        logging: {
          cloudWatch: {
            logGroup: new awslogs.LogGroup(this, `CyberEval-Web-${env}-CodeBuild-LogGroup`, {
              logGroupName: `codebuild/cybereval-Web-${env.toString().toLowerCase()}`,
              retention: retention,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
          },
        },
        timeout: Duration.minutes(15),
        badge: false,
      });

      //Create Source stage
      const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
        actionName: "CodeCommit",
        repository: repository,
        branch: branch,
        output: sourceArtifact,
        //output: sourceOutput,
        role: pipelineRole,
      });

      //Create second stage in pipeline which will be codebuild action
      const buildAction = new codepipeline_actions.CodeBuildAction({
        actionName: "CodeBuild",
        role: pipelineRole,
        project,
        input: sourceArtifact,
        //input: sourceOutput, // The build action must use the CodeCommitSourceAction output as input.
        //outputs: [buildOutput], // optional
      });
      //Create Manual Approval Action
      const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
        actionName: "Approve",
        role: pipelineRole,
      });

      const deployActionRolling = new codepipeline_actions.EcsDeployAction({
        actionName: "DeployAction",
        service: fargateService,
        deploymentTimeout: cdk.Duration.minutes(60),
        role: pipelineRole,
        imageFile: sourceArtifact.atPath(`imageDef-${env}.json`),
      });

      /**
       * Build Stage Object. If the env === Dev then the build stage will only include a build action
       * if the env === Staging or Prod then we will include the manual approval stage in the build action
       */
      const buildStage = env === "Dev" ? [buildAction] : [manualApprovalAction, buildAction];
      const deployStage =
        env === "Dev" ? [deployActionRolling] : env === "Stag" ? [manualApprovalAction, deployActionRolling] : [manualApprovalAction, deployActionRolling];

      //Create code pipeline with stages
      new codepipeline.Pipeline(this, `CyberEval-Web-Pipeline-${env}`, {
        pipelineName: `CyberEval-Web-${env}`,
        artifactBucket: artifactBucket,
        role: pipelineRole,
        stages: [
          {
            stageName: "Source",
            actions: [sourceAction],
          },
          {
            stageName: "Build",
            actions: [buildAction],
          },
          {
            stageName: "Deploy",
            actions: deployStage,
          },
        ],
      });
    });
  }
}
