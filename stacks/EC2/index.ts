import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import { App, Duration, Stack, StackProps } from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import * as logs from "@aws-cdk/aws-logs";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import { Port } from "@aws-cdk/aws-ec2";
import { env } from "process";

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

export interface EC2StackStackProps extends StackProps {
  readonly vpcID: string;
  readonly prefix: string;
  //readonly service: string;
  //readonly service: string;
}

export class EC2ResourceStack extends Stack {
  constructor(app: App, id: string, props: EC2StackStackProps) {
    super(app, id, props);

    const prefix = props.prefix;
    //const service = props.service;
    const vpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    //Create Security Group
    const ALBSecurityGroup = new ec2.SecurityGroup(this, `${prefix}-ALB-SecurityGroup`, {
      securityGroupName: `${prefix}-ALB-SecurityGroup`,
      description: `ECS ALB Security Group ${prefix}`,
      vpc: vpc,
    });
    ALBSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow all TCP from port 80");
    ALBSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow all TCP from port 443");
    ALBSecurityGroup.allowAllOutbound;
    ALBSecurityGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const publicSubnet1a = ec2.Subnet.fromSubnetId(this, `${prefix}-public-subnet-1a`, "subnet-04b3886671d49fcb0");
    const publicSubnet1b = ec2.Subnet.fromSubnetId(this, `${prefix}-public-subnet-1b`, "subnet-0e149343bb256a85a");

    const nonProdALB = new elbv2.ApplicationLoadBalancer(this, `${prefix}-NonProd-ALB`, {
      vpc: vpc,
      internetFacing: true,
      loadBalancerName: "CyberEval-NonProd",
      vpcSubnets: { subnets: [publicSubnet1a, publicSubnet1b] },
      securityGroup: ALBSecurityGroup,
    });

    //redirects HTTP port 80 to HTTPS port 443
    nonProdALB.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      targetPort: 443,
    });
    cdk.Tags.of(nonProdALB).add("application", "CyberEval");
    cdk.Tags.of(nonProdALB).add("environment", "Dev");
  }
}
