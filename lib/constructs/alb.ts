import {
  Duration,
  aws_certificatemanager as acm,
  aws_ec2 as ec2,
  aws_elasticloadbalancingv2 as elbv2,
  aws_route53 as route53,
  aws_route53_targets as targets,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface Domain {
  name: string;
  hostedZoneId: string;
  hostedZoneName: string;
}

export interface AlbProps {
  vpc: ec2.IVpc;
  /** With a domain: ACM certificate, HTTPS and a Route 53 alias. Without: plain HTTP on the ALB name. */
  domain?: Domain;
}

/** Internet-facing ALB. Services attach to `listener` with path rules. */
export class Alb extends Construct {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;
  /** What the browser sees; the API validates its CORS origin against it. */
  public readonly origin: string;

  constructor(scope: Construct, id: string, props: AlbProps) {
    super(scope, id);
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      dropInvalidHeaderFields: true,
      idleTimeout: Duration.seconds(60),
    });
    const notFound = elbv2.ListenerAction.fixedResponse(404, {
      contentType: 'text/plain',
      messageBody: 'Not found',
    });

    if (!props.domain) {
      this.listener = this.loadBalancer.addListener('Http', { port: 80, defaultAction: notFound });
      this.origin = `http://${this.loadBalancer.loadBalancerDnsName}`;
      return;
    }

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.domain.hostedZoneId,
      zoneName: props.domain.hostedZoneName,
    });
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domain.name,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    this.listener = this.loadBalancer.addListener('Https', {
      port: 443,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: notFound,
    });
    this.loadBalancer.addListener('HttpRedirect', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });
    new route53.ARecord(this, 'Alias', {
      zone,
      recordName: props.domain.name,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.loadBalancer)),
    });
    this.origin = `https://${props.domain.name}`;
  }
}
