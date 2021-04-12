import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import { Construct, App, Stack, StackProps } from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import * as logs from "@aws-cdk/aws-logs";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import * as ecr from "@aws-cdk/aws-ecr";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import * as cloudCompoments from "@cloudcomponents/cdk-blue-green-container-deployment";

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

export interface ECSTaskDefinitionStackProps extends StackProps {
  readonly vpcID: string;
  readonly environments: string[];
  readonly prefix: string;
}

export class ECSServicesStack extends Stack {
  constructor(scope: Construct, id: string, props: ECSTaskDefinitionStackProps) {
    super(scope, id, props);

    // Constants
    const prefix = props.prefix;
    //const service = props.service;
    const envs = props.environments;

    //Lookup Private Subnets via VPC
    const role = iam.Role.fromRoleArn(this, "Existing Role", `arn:aws-us-gov:iam::${account}:role/${prefix}-ECSTasks-Role`);
    const vpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    const cyberevalAPIRepo = ecr.Repository.fromRepositoryName(this, `Imported-CyberEval-API-Repository`, `cybereval-api`);
    const cyberevalWebRepo = ecr.Repository.fromRepositoryName(this, `Imported-CyberEval-Web-Repository`, `cybereval-web`);
    const cyberevalIDPRepo = ecr.Repository.fromRepositoryName(this, `Imported-CyberEval-IDP-Repository`, `cybereval-idp`);

    const secretConnectionStringDev = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "secretConnectionStringDev",
      "arn:aws-us-gov:secretsmanager:us-gov-west-1:111055882567:secret:CyberEval_Dev_ConnectionString-nK9SYW"
    );

    //const nonProdALB = elbv2.ApplicationLoadBalancer.fromLookup(this, "imported", {
    //  loadBalancerTags: { application: "Cybereval", environment: "Dev" },
    //});

    //Create Security Group
    const nonProdSecurityGroup = new ec2.SecurityGroup(this, `${prefix}-ALB-NonProd-SecurityGroup`, {
      securityGroupName: `${prefix}-ALB-NonProd-SecurityGroup`,
      description: `ECS ALB Security Group ${prefix}`,
      vpc: vpc,
    });
    //nonProdSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow all TCP from port 80");
    //nonProdSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow all TCP from port 443");
    nonProdSecurityGroup.allowAllOutbound;
    nonProdSecurityGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    //Add inbound rules for security group
    const ipv4Addresses = [
      { ip: "162.242.24.65/32", desc: "Kaise - Home" },
      { ip: "173.79.36.3/32", desc: "Sergey - Home" },
      { ip: "76.104.57.213/32", desc: "Mike - Home" },
      { ip: "100.36.32.150/32", desc: "Eric - Home" },
    ];
    ipv4Addresses.forEach((address) => {
      nonProdSecurityGroup.addIngressRule(ec2.Peer.ipv4(address.ip), ec2.Port.allTcp(), address.desc);
    });

    const prodSecurityGroup = new ec2.SecurityGroup(this, `${prefix}-ALB-Prod-SecurityGroup`, {
      securityGroupName: `${prefix}-ALB-Prod-SecurityGroup`,
      description: `ECS ALB Security Group ${prefix}`,
      vpc: vpc,
    });
    prodSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow all TCP from port 80");
    prodSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow all TCP from port 443");
    prodSecurityGroup.allowAllOutbound;
    prodSecurityGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const devCluster = ecs.Cluster.fromClusterAttributes(this, `CyberEval-Cluster-Dev`, {
      clusterName: `CyberEval-Dev`,
      vpc: vpc,
      securityGroups: [nonProdSecurityGroup],
    });

    const stagCluster = ecs.Cluster.fromClusterAttributes(this, `CyberEval-Cluster-Stag`, {
      clusterName: `CyberEval-Stag`,
      vpc: vpc,
      securityGroups: [nonProdSecurityGroup],
    });

    const prodCluster = ecs.Cluster.fromClusterAttributes(this, `CyberEval-Cluster-Prod`, {
      clusterName: `CyberEval-Prod`,
      vpc: vpc,
      securityGroups: [prodSecurityGroup],
    });

    const publicSubnet1a = ec2.Subnet.fromSubnetId(this, `${prefix}-public-subnet-1a`, "subnet-0e149343bb256a85a");
    const publicSubnet1b = ec2.Subnet.fromSubnetId(this, `${prefix}-public-subnet-1b`, "subnet-04b3886671d49fcb0");
    const privateSubnet1a = ec2.Subnet.fromSubnetId(this, `${prefix}-private-subnet-1a`, "subnet-06b699a3130e668ef");
    const privateSubnet1b = ec2.Subnet.fromSubnetId(this, `${prefix}-private-subnet-1b`, "subnet-034c150cf4beea36a");

    const nonProdALB = new elbv2.ApplicationLoadBalancer(this, `${prefix}-NonProd-ALB`, {
      vpc: vpc,
      internetFacing: true,
      loadBalancerName: "CyberEval-NonProd",
      vpcSubnets: { subnets: [publicSubnet1a, publicSubnet1b] },
      securityGroup: nonProdSecurityGroup,
      ipAddressType: elbv2.IpAddressType.DUAL_STACK,
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
      securityGroup: prodSecurityGroup,
      ipAddressType: elbv2.IpAddressType.DUAL_STACK,
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

    const nonProdHTTPSListener = nonProdALB.addListener(`CyberEval-NonProd-Listener`, {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificateArns: [`arn:aws-us-gov:acm:us-gov-west-1:111055882567:certificate/bad95967-598e-42c0-a068-94f73aacde95`],
    });

    const prodHTTPSListener = prodALB.addListener(`CyberEval-Prod-Listener`, {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificateArns: [`arn:aws-us-gov:acm:us-gov-west-1:111055882567:certificate/bad95967-598e-42c0-a068-94f73aacde95`],
    });

    //const prodTestListener = prodALB.addListener("TestListener", {
    //  port: 8080,
    //});

    prodHTTPSListener.addAction("default", {
      action: elbv2.ListenerAction.fixedResponse(200, { messageBody: "This is the ALB Default Action" }),
    });

    nonProdHTTPSListener.addAction("default", {
      action: elbv2.ListenerAction.fixedResponse(200, { messageBody: "This is the ALB Default Action" }),
    });

    prodHTTPSListener.addAction("Fixed", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/healthcheck"])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: elbv2.ContentType.TEXT_PLAIN,
        messageBody: "OK",
      }),
    });

    nonProdHTTPSListener.addAction("Fixed", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/healthcheck"])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: elbv2.ContentType.TEXT_PLAIN,
        messageBody: "OK",
      }),
    });

    const APISrvDev = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `api-dev.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-API-Dev-LogGroup`, {
        logGroupName: `ecs/container/cybereval-api-dev`, //Ex: cybereval-api
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-API-Dev-TaskDefinition`, {
        family: `CyberEval-API-Dev`, //CyberEval-API-Dev
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-API-Dev-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalAPIRepo, `Dev`), //ecs.EcrImage.fromEcrRepository(repo),
          memoryLimitMiB: memory,
          cpu: cpu,
          essential: true,
          logging: new ecs.AwsLogDriver({
            streamPrefix: "ecs",
            logGroup: logGroup,
          }),
          secrets: {
            // Retrieved from AWS Secrets Manager at start up
            ConnectionStrings__CyberEval: ecs.Secret.fromSecretsManager(secretConnectionStringDev),
          },
        })
        .addPortMappings({
          containerPort: 443,
          protocol: ecs.Protocol.TCP,
          hostPort: 443,
        });
      taskDef.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

      const FargateService = new ecs.FargateService(this, `CyberEval-API-Dev-Service`, {
        serviceName: `CyberEval-API-Dev`,
        desiredCount: 1,
        cluster: devCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [nonProdSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = nonProdHTTPSListener.addTargets(`CyberEval-API-Dev-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-API-Dev`,
        //stickinessCookieDuration: cdk.Duration.minutes(5),
        //stickinessCookieName: "CyberEvalIDPCookie",
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

      nonProdHTTPSListener.addAction(`CyberEval-API-Dev-Action`, {
        priority: 1,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    /*********************************************************************************************** */

    const APISrvStag = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `api-stag.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-API-Stag-LogGroup`, {
        logGroupName: `ecs/container/cybereval-api-Stag`, //Ex: cybereval-api
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-API-Stag-TaskDefinition`, {
        family: `CyberEval-API-Stag`, //CyberEval-API-Stag
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-API-Stag-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalAPIRepo, `Stag`), //ecs.EcrImage.fromEcrRepository(repo),
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

      const FargateService = new ecs.FargateService(this, `CyberEval-API-Stag-Service`, {
        serviceName: `CyberEval-API-Stag`,
        desiredCount: 1,
        cluster: stagCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [nonProdSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = nonProdHTTPSListener.addTargets(`CyberEval-API-Stag-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-API-Stag`,
        //stickinessCookieDuration: cdk.Duration.hours(1),
        //stickinessCookieName: "CyberEvalIDPCookie",
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

      nonProdHTTPSListener.addAction(`CyberEval-API-Stag-Action`, {
        priority: 2,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    /*********************************************************************************************** */

    const APISrvProd = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `api.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-API-Prod-LogGroup`, {
        logGroupName: `ecs/container/cybereval-api-Prod`, //Ex: cybereval-api
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-API-Prod-TaskDefinition`, {
        family: `CyberEval-API-Prod`, //CyberEval-API-Prod
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-API-Prod-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalAPIRepo, `Prod`), //ecs.EcrImage.fromEcrRepository(repo),
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

      const FargateService = new ecs.FargateService(this, `CyberEval-API-Prod-Service`, {
        serviceName: `CyberEval-API-Prod`,
        desiredCount: 1,
        cluster: prodCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [prodSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const scaling = FargateService.autoScaleTaskCount({ maxCapacity: 2 });
      scaling.scaleOnCpuUtilization("CpuScaling", {
        targetUtilizationPercent: 80,
      });

      const targetGroup = prodHTTPSListener.addTargets(`CyberEval-API-Prod-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-API-Prod`,
        //stickinessCookieDuration: cdk.Duration.hours(1),
        //stickinessCookieName: "CyberEvalIDPCookie",
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

      prodHTTPSListener.addAction(`CyberEval-API-Prod-Action`, {
        priority: 1,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    const IDPSrvDev = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `idp-dev.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-IDP-Dev-LogGroup`, {
        logGroupName: `ecs/container/cybereval-IDP-dev`, //Ex: cybereval-IDP
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-IDP-Dev-TaskDefinition`, {
        family: `CyberEval-IDP-Dev`, //CyberEval-IDP-Dev
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-IDP-Dev-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalIDPRepo, `Dev`), //ecs.EcrImage.fromEcrRepository(repo),
          memoryLimitMiB: memory,
          cpu: cpu,
          essential: true,
          logging: new ecs.AwsLogDriver({
            streamPrefix: "ecs",
            logGroup: logGroup,
          }),
          environment: {
            BlazorClientUrl: "https://web-dev.gasatraq.org",
          },
        })
        .addPortMappings({
          containerPort: 443,
          protocol: ecs.Protocol.TCP,
          hostPort: 443,
        });
      taskDef.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

      const FargateService = new ecs.FargateService(this, `CyberEval-IDP-Dev-Service`, {
        serviceName: `CyberEval-IDP-Dev`,
        desiredCount: 1,
        cluster: devCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [nonProdSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = nonProdHTTPSListener.addTargets(`CyberEval-IDP-Dev-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-IDP-Dev`,
        //stickinessCookieDuration: cdk.Duration.minutes(5),
        //stickinessCookieName: "CyberEvalIDPCookie",
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

      nonProdHTTPSListener.addAction(`CyberEval-IDP-Dev-Action`, {
        priority: 3,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    /*********************************************************************************************** */

    const IDPSrvStag = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `idp-stag.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-IDP-Stag-LogGroup`, {
        logGroupName: `ecs/container/cybereval-IDP-Stag`, //Ex: cybereval-IDP
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-IDP-Stag-TaskDefinition`, {
        family: `CyberEval-IDP-Stag`, //CyberEval-IDP-Stag
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-IDP-Stag-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalIDPRepo, `Stag`), //ecs.EcrImage.fromEcrRepository(repo),
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

      const FargateService = new ecs.FargateService(this, `CyberEval-IDP-Stag-Service`, {
        serviceName: `CyberEval-IDP-Stag`,
        desiredCount: 1,
        cluster: stagCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [nonProdSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = nonProdHTTPSListener.addTargets(`CyberEval-IDP-Stag-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-IDP-Stag`,
        //stickinessCookieDuration: cdk.Duration.hours(1),
        //stickinessCookieName: "CyberEvalIDPCookie",
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

      nonProdHTTPSListener.addAction(`CyberEval-IDP-Stag-Action`, {
        priority: 4,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    /*********************************************************************************************** */

    const IDPSrvProd = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `idp.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-IDP-Prod-LogGroup`, {
        logGroupName: `ecs/container/cybereval-IDP-Prod`, //Ex: cybereval-IDP
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-IDP-Prod-TaskDefinition`, {
        family: `CyberEval-IDP-Prod`, //CyberEval-IDP-Prod
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-IDP-Prod-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalIDPRepo, `Prod`), //ecs.EcrImage.fromEcrRepository(repo),
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

      const FargateService = new ecs.FargateService(this, `CyberEval-IDP-Prod-Service`, {
        serviceName: `CyberEval-IDP-Prod`,
        desiredCount: 1,
        cluster: prodCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [prodSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = prodHTTPSListener.addTargets(`CyberEval-IDP-Prod-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-IDP-Prod`,
        //stickinessCookieDuration: cdk.Duration.hours(1),
        //stickinessCookieName: "CyberEvalIDPCookie",
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

      prodHTTPSListener.addAction(`CyberEval-IDP-Prod-Action`, {
        priority: 2,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });

      ////BlueGreenDeployment Depenencies
      //const testTargetGroup = new elbv2.ApplicationTargetGroup(this, "CyberEval-IDP-Prod-TestTargetGroup", {
      //  port: 8080,
      //  targetType: elbv2.TargetType.IP,
      //  vpc,
      //});
      //
      //prodTestListener.addTargetGroups("CyberEval-IDP-Prod-AddTestTg", {
      //  targetGroups: [testTargetGroup],
      //});
      //
      //// Will be replaced by CodeDeploy in CodePipeline
      //const dummytaskDef = new ecs.FargateTaskDefinition(this, `CyberEval-IDP-Prod-DummyTaskDefinition`, {
      //  family: `CyberEval-IDP-Prod`,
      //  executionRole: role,
      //  taskRole: role,
      //  memoryLimitMiB: memory,
      //  cpu: cpu,
      //});
      //
      //dummytaskDef.addContainer(`CyberEval-IDP-Prod-DummyContainer`, {
      //  image: ecs.ContainerImage.fromRegistry("nginx"), //ecs.EcrImage.fromEcrRepository(repo),
      //});
      //
      //FargateService.connections.allowFrom(prodALB, ec2.Port.tcp(80));
      //FargateService.connections.allowFrom(prodALB, ec2.Port.tcp(8080));
    };

    const WebSrvDev = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `web-dev.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-Web-Dev-LogGroup`, {
        logGroupName: `ecs/container/cybereval-Web-dev`, //Ex: cybereval-Web
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-Web-Dev-TaskDefinition`, {
        family: `CyberEval-Web-Dev`, //CyberEval-Web-Dev
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-Web-Dev-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalWebRepo, `Dev`), //ecs.EcrImage.fromEcrRepository(repo),
          memoryLimitMiB: memory,
          cpu: cpu,
          essential: true,
          logging: new ecs.AwsLogDriver({
            streamPrefix: "ecs",
            logGroup: logGroup,
          }),
          environment: {
            // clear text, not for sensitive data
            ASPNETCORE_ENVIRONMENT: "dev",
          },
        })
        .addPortMappings({
          containerPort: 443,
          protocol: ecs.Protocol.TCP,
          hostPort: 443,
        });
      taskDef.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

      const FargateService = new ecs.FargateService(this, `CyberEval-Web-Dev-Service`, {
        serviceName: `CyberEval-Web-Dev`,
        desiredCount: 1,
        cluster: devCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [nonProdSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = nonProdHTTPSListener.addTargets(`CyberEval-Web-Dev-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-Web-Dev`,
        //stickinessCookieDuration: cdk.Duration.minutes(5),
        //stickinessCookieName: "CyberEvalWebCookie",
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

      nonProdHTTPSListener.addAction(`CyberEval-Web-Dev-Action`, {
        priority: 5,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    /*********************************************************************************************** */

    const WebSrvStag = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `web-stag.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-Web-Stag-LogGroup`, {
        logGroupName: `ecs/container/cybereval-Web-Stag`, //Ex: cybereval-Web
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-Web-Stag-TaskDefinition`, {
        family: `CyberEval-Web-Stag`, //CyberEval-Web-Stag
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-Web-Stag-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalWebRepo, `Stag`), //ecs.EcrImage.fromEcrRepository(repo),
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

      const FargateService = new ecs.FargateService(this, `CyberEval-Web-Stag-Service`, {
        serviceName: `CyberEval-Web-Stag`,
        desiredCount: 1,
        cluster: stagCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [nonProdSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const targetGroup = nonProdHTTPSListener.addTargets(`CyberEval-Web-Stag-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-Web-Stag`,
        //stickinessCookieDuration: cdk.Duration.hours(1),
        //stickinessCookieName: "CyberEvalWebCookie",
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

      nonProdHTTPSListener.addAction(`CyberEval-Web-Stag-Action`, {
        priority: 6,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    /*********************************************************************************************** */

    const WebSrvProd = () => {
      let memory = 512;
      let cpu = 256;
      let URL = `web.gasatraq.org`;

      const logGroup = new logs.LogGroup(this, `CyberEval-Web-Prod-LogGroup`, {
        logGroupName: `ecs/container/cybereval-Web-Prod`, //Ex: cybereval-Web
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDef = new ecs.FargateTaskDefinition(this, `CyberEval-Web-Prod-TaskDefinition`, {
        family: `CyberEval-Web-Prod`, //CyberEval-Web-Prod
        executionRole: role,
        taskRole: role,
        memoryLimitMiB: memory,
        cpu: cpu,
      });

      //DO NOT CHANGE THE NAME OF THIS CONTAINER WITHOUT CHANGING THE imageDef.json file in each repo
      taskDef
        .addContainer(`CyberEval-Web-Prod-Container`, {
          image: ecs.ContainerImage.fromEcrRepository(cyberevalWebRepo, `Prod`), //ecs.EcrImage.fromEcrRepository(repo),
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

      const FargateService = new ecs.FargateService(this, `CyberEval-Web-Prod-Service`, {
        serviceName: `CyberEval-Web-Prod`,
        desiredCount: 1,
        cluster: prodCluster,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        taskDefinition: taskDef,
        vpcSubnets: { subnets: [privateSubnet1a, privateSubnet1b] },
        securityGroups: [prodSecurityGroup],
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
        circuitBreaker: {
          rollback: false,
        },
      });

      const scaling = FargateService.autoScaleTaskCount({ maxCapacity: 2 });
      scaling.scaleOnCpuUtilization("CpuScaling", {
        targetUtilizationPercent: 80,
      });

      const targetGroup = prodHTTPSListener.addTargets(`CyberEval-Web-Prod-TargetGroup`, {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        targets: [FargateService],
        targetGroupName: `CyberEval-Web-Prod`,
        //stickinessCookieDuration: cdk.Duration.hours(1),
        //stickinessCookieName: "CyberEvalWebCookie",
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

      prodHTTPSListener.addAction(`CyberEval-Web-Prod-Action`, {
        priority: 3,
        conditions: [elbv2.ListenerCondition.hostHeaders([URL])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });
    };

    if (envs.includes("Dev")) {
      APISrvDev();
      IDPSrvDev();
      WebSrvDev();
    }
    if (envs.includes("Stag")) {
      APISrvStag();
      IDPSrvStag();
      WebSrvStag();
    }
    if (envs.includes("Prod")) {
      APISrvProd();
      IDPSrvProd();
      WebSrvProd();
    }
  }
}

// 172.16.2.184
