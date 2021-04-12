/** 
FargateService.listener.addAction("", {
  action: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", host: "#{host}", path: "/#{path}", query: "#{query}" }),
});

const targetBasedRoute = HTTPSListener.addTargets(`${service}-${env}-Forward`, {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  priority: 1,
  conditions: [elbv2.ListenerCondition.hostHeaders(["api-dev.gasatraq.org"])],
  targetGroupName: `${service}-${env}-Forward`,
  targets: [FargateService],
});

const HTTPListener = nonProdLoadBalancer.addListener(`${prefix}-${env}-HTTPListener`, {
  port: 80,
  protocol: elbv2.ApplicationProtocol.HTTP,
  defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", host: "#{host}", path: "/#{path}", query: "#{query}" }),
});

FargateService.taskDefinition.executionRole?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryPowerUser"));

const targetGroup1 = elbv2.ApplicationTargetGroup.fromTargetGroupAttributes(this, "targetGroup1", { targetGroupArn: target.targetGroupArn });

HTTPSListener.addTargetGroups(`${service}-${env}-HTTPS-TargetGroups`, {
  targetGroups: [targetGroup1],
});

const existingCertifcate = certificate.Certificate.fromCertificateArn(
  this,
  `ExistingCertificate`,
  "arn:aws-us-gov:acm:us-gov-west-1:111055882567:certificate/bad95967-598e-42c0-a068-94f73aacde95"
);

FargateService.listener.addCertificates("certs", [existingCertifcate]);

const HTTPListener = nonProdLoadBalancer.addListener(`${prefix}-${env}-HTTPListener`, {
  port: 80,
  protocol: elbv2.ApplicationProtocol.HTTP,
  defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", host: "#{host}", path: "/#{path}", query: "#{query}" }),
});

HTTPListener.addAction("DummyResponce", {
  priority: 10,
  conditions: [elbv2.ListenerCondition.pathPatterns(["/ok"])],
  action: elbv2.ListenerAction.fixedResponse(404, {
    contentType: elbv2.ContentType.TEXT_PLAIN,
    messageBody: "DummyResponse",
  }),
});

const HTTPSListener = nonProdLoadBalancer.addListener(`${prefix}-dev-443-listener`, {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificateArns: [`arn:aws-us-gov:acm:us-gov-west-1:111055882567:certificate/bad95967-598e-42c0-a068-94f73aacde95`],
});

HTTPSListener.addTargetGroups(`${service}-${env}-HTTPS-TargetGroups`, {
  targetGroups: [FargateService.targetGroup],
});


*/

/**
 * import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import { App, Duration, Stack, StackProps } from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import * as logs from "@aws-cdk/aws-logs";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import { Port } from "@aws-cdk/aws-ec2";
import { env } from "process";
import * as ecsPatterns from "@aws-cdk/aws-ecs-patterns";
import * as certificate from "@aws-cdk/aws-certificatemanager";
import * as ecr from "@aws-cdk/aws-ecr";
import { LoadBalancer, LoadBalancerGeneration } from "@aws-cdk/aws-codedeploy";

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

/**

ALB (NonProd, Prod)
Task Definitions (API-Dev, API-Stag, API-Prod, Web-Dev, Web-Stag, Web-Prod, IDP-Dev, IDP-Stag, IDP-Prod)

 */

//Define props here
export interface ECSTaskDefinitionStackProps extends StackProps {
  readonly vpcID: string;
  readonly environments: string[];
  readonly prefix: string;
  //readonly service: string;
  //readonly privateSubnets: string[];
  //readonly publicSubnets: string[];
}

export class ECSServicesStack extends Stack {
  constructor(app: App, id: string, props: ECSTaskDefinitionStackProps) {
    super(app, id, props);

    // Constants
    const prefix = props.prefix;
    const envs = props.environments;

    //Lookup Private Subnets via VPC
    const role = iam.Role.fromRoleArn(this, "Existing Role", `arn:aws-us-gov:iam::${account}:role/${prefix}-ECSTasks-Role`);
    const vpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    //Create Security Group
    const securityGroup = new ec2.SecurityGroup(this, `${prefix}-ALB-SecurityGroup`, {
      securityGroupName: `${prefix}-ALB-SecurityGroup`,
      description: `ECS ALB Security Group ${prefix}`,
      vpc: vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow all TCP from port 80");
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow all TCP from port 443");
    securityGroup.allowAllOutbound;
    securityGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const publicSubnet1a = ec2.Subnet.fromSubnetId(this, `${prefix}-public-subnet-1a`, "subnet-04b3886671d49fcb0");
    const publicSubnet1b = ec2.Subnet.fromSubnetId(this, `${prefix}-public-subnet-1b`, "subnet-0e149343bb256a85a");
    const privateSubnet1a = ec2.Subnet.fromSubnetId(this, `CyberEval-API-private-subnet-1a`, "subnet-06b699a3130e668ef");
    const privateSubnet1b = ec2.Subnet.fromSubnetId(this, `CyberEval-API-private-subnet-1b`, "subnet-034c150cf4beea36a");

    const nonProdALB = new elbv2.ApplicationLoadBalancer(this, `${prefix}-NonProd-ALB`, {
      vpc: vpc,
      internetFacing: true,
      loadBalancerName: "CyberEval-NonProd",
      vpcSubnets: { subnets: [publicSubnet1a, publicSubnet1b] },
      securityGroup: securityGroup,
      ipAddressType: elbv2.IpAddressType.IPV4,
    });

    nonProdALB.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    cdk.Tags.of(nonProdALB).add("application", "CyberEval");
    cdk.Tags.of(nonProdALB).add("environment", "Dev");

    const prodALB = new elbv2.ApplicationLoadBalancer(this, `${prefix}-Prod-ALB`, {
      vpc: vpc,
      internetFacing: true,
      loadBalancerName: "CyberEval-Prod",
      vpcSubnets: { subnets: [publicSubnet1a, publicSubnet1b] },
      securityGroup: securityGroup,
      ipAddressType: elbv2.IpAddressType.IPV4,
    });
    cdk.Tags.of(prodALB).add("application", "CyberEval");
    cdk.Tags.of(prodALB).add("environment", "Prod");

    //redirects HTTP port 80 to HTTPS port 443
    prodALB.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    //Task Definition for API Service
    envs.forEach((env) => {
      //Foreach Environment Create a new task Definition

      //Tenerary Statement for compute
      let memory = env === "Dev" ? 512 : env === "Stag" ? 512 : env === "Prod" ? 4096 : 512;
      let cpu = env === "Dev" ? 256 : env === "Stag" ? 256 : env === "Prod" ? 2048 : 256;

      //Host Header URL
      const URL = env === "Dev" || "Stag" ? `api-${env.toString().toLowerCase()}.gasatraq.org` : `api.gasatraq.com`;

      // Import Existing ECS Cluster
      const existingCluster = ecs.Cluster.fromClusterAttributes(this, `CyberEval-Existing-Cluster-API`, {
        clusterName: `${prefix}-${env}`,
        vpc: vpc,
        securityGroups: [securityGroup],
      });

      const repo = ecr.Repository.fromRepositoryName(this, `CyberEval-API-${env}-Repo`, `cybereval-api`);
      const rententionPolicy = env === "Prod" ? logs.RetentionDays.INFINITE : logs.RetentionDays.ONE_MONTH;

      // Create log group for API Service
      const logGroup = new logs.LogGroup(this, `CyberEval-API-${env}-LG`, {
        logGroupName: `ecs/container/cybereval-api-${env.toString().toLowerCase()}`, //Ex: cybereval-api
        retention: rententionPolicy,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-API-${env}-TaskDefinition`, {
        family: `CyberEval-API-${env}`, //CyberEval-API-Dev
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-API-${env}-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(repo, `${env}`), //ecs.EcrImage.fromEcrRepository(repo),
          memoryLimitMiB: memory,
          cpu: cpu,
          essential: true,
          logging: new ecs.AwsLogDriver({
            streamPrefix: "ecs",
            logGroup: logGroup,
          }),
        })
        .addPortMappings({
          containerPort: 443,
          protocol: ecs.Protocol.TCP,
          hostPort: 443,
        });

      taskDef.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

      const FargateService = new ecs.FargateService(this, `CyberEval-API-${env}-Service`, {
        serviceName: `CyberEval-API-${env}`,
        desiredCount: 1,
        cluster: existingCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [securityGroup],
      });

      const HTTPSListener =
        env === "Dev" || "Stag"
          ? nonProdALB.addListener(`CyberEval-API-${env}-HTTPSListener`, {
              port: 443,
              protocol: elbv2.ApplicationProtocol.HTTPS,
              certificateArns: [`arn:aws-us-gov:acm:us-gov-west-1:111055882567:certificate/bad95967-598e-42c0-a068-94f73aacde95`],
            })
          : prodALB.addListener(`CyberEval-API-${env}-HTTPSListener`, {
              port: 443,
              protocol: elbv2.ApplicationProtocol.HTTPS,
              certificateArns: [`arn:aws-us-gov:acm:us-gov-west-1:111055882567:certificate/bad95967-598e-42c0-a068-94f73aacde95`],
            });

      const targetGroup = HTTPSListener.addTargets(`CyberEval-API-${env}-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-API-${env}`,
      });

      targetGroup.configureHealthCheck({
        path: "/healthcheck",
        enabled: true,
        port: "traffic-port",
        protocol: elbv2.Protocol.HTTPS,
        healthyThresholdCount: 5,
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
      });

      HTTPSListener.addAction(`CyberEval-API-${env}-Action`, {
        priority: 1,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    });
  }
}

 */
