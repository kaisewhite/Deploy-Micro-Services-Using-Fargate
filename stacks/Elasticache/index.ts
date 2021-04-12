import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import { Construct, App, Stack, StackProps } from "@aws-cdk/core";
import * as elasticache from "@aws-cdk/aws-elasticache";

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

export interface ElasticacheStackProps extends StackProps {
  readonly vpcID: string;
  //readonly environments: string[];
  readonly prefix: string;
}

export class ElasticacheStack extends Stack {
  constructor(scope: App, id: string, props: ElasticacheStackProps) {
    super(scope, id, props);

    // Constants
    const prefix = props.prefix;
    //const service = props.service;
    //const envs = props.environments;
    //Lookup Private Subnets via VPC
    const vpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    const privateSubnet1a = ec2.Subnet.fromSubnetId(this, `${prefix}-private-subnet-1a`, "subnet-06b699a3130e668ef");
    const privateSubnet1b = ec2.Subnet.fromSubnetId(this, `${prefix}-private-subnet-1b`, "subnet-034c150cf4beea36a");

    //Create Security Group
    const devRedisSG = new ec2.SecurityGroup(this, `${prefix}-Redis-Dev-SecurityGroup`, {
      securityGroupName: `${prefix}-Redis-Dev`,
      description: `${prefix} Elasticache Redis Security Group`,
      vpc: vpc,
    });

    devRedisSG.allowAllOutbound;
    devRedisSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow all TCP from port 80");
    devRedisSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow all TCP from port 443");
    devRedisSG.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const subnetGroup = new elasticache.CfnSubnetGroup(this, "RedisClusterPrivateSubnetGroup", {
      cacheSubnetGroupName: "redis-subnet",
      subnetIds: [privateSubnet1a.subnetId, privateSubnet1b.subnetId],
      description: "subnet group for Elasticache Redis Instance(s)",
    });
    const redis = new elasticache.CfnCacheCluster(this, `Dev-Redis-Instance`, {
      engine: "redis",
      cacheNodeType: "cache.t2.small",
      numCacheNodes: 1,
      clusterName: `${prefix}-dev-redis`,
      preferredAvailabilityZone: "us-gov-west-1",
      vpcSecurityGroupIds: [devRedisSG.securityGroupId],
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
    });
    redis.addDependsOn(subnetGroup);
  }
}

// 172.16.2.184
