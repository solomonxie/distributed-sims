// Cloud networking (group sd-vpc): VPC subnets and routing, security groups vs NACLs, peering and transit gateways.
import { boardDemo, N } from '../machine/lib/board';
import type { Actor, SeqMsg } from './lib';
import { sdDemo, seqFrames } from './lib';

const G = 'sd-vpc';

boardDemo(G, 'sd-vpc-layout', 'VPC layout', 'Public and private subnets, route tables, NAT, and what is reachable from the internet.', {
  layout: [
    'Subnets',
    {
      panel: 'VPC 10.0.0.0/16',
      nodes: [
        N('inet', 355, 20, 290, 90, 'internet'),
        N('igw', 355, 150, 290, 90, 'internet gateway', undefined, { detail: { title: 'Internet gateway', text: 'The VPC’s door to the internet. Only subnets whose route table points 0.0.0.0/0 at it are public.', code: 'Destination   Target\n10.0.0.0/16   local\n0.0.0.0/0     igw-0a1b' } }),
        N('alb', 30, 300, 290, 110, 'load balancer', 'public 10.0.1.0/24'),
        N('nat', 680, 300, 290, 110, 'NAT gateway', 'public 10.0.2.0/24', { detail: { title: 'NAT gateway', text: 'Lets private instances reach out (package installs, APIs) without being reachable from outside.', code: '# private route table\n0.0.0.0/0     nat-07c9' } }),
        N('app', 30, 520, 290, 110, 'app servers', 'private 10.0.11.0/24'),
        N('db', 30, 740, 290, 110, 'database', 'private 10.0.21.0/24'),
        N('rt', 680, 520, 290, 110, 'private route table', 'no route to IGW'),
      ],
      edges: ['inet>igw', 'igw>alb', 'alb>app', 'app>db', 'app>nat', 'nat>igw'],
      beats: [
        { note: 'A VPC is your own private address space, here 10.0.0.0/16, isolated from other tenants.', rows: [['CIDR', '10.0.0.0/16']] },
        { note: 'Public subnets route 0.0.0.0/0 to the internet gateway. Only the load balancer and NAT live there.', hot: { igw: 'current', alb: 'current', nat: 'current', 'inet>igw': 'accent', 'igw>alb': 'accent' }, rows: [['internet-facing', 'LB only', 'ok']] },
        { note: 'App servers sit in a private subnet: the internet has no route to them.', hot: { app: 'current', rt: 'write', 'alb>app': 'accent' }, rows: [['inbound path', 'via LB only']] },
        { note: 'The database is private too, reachable only from the app tier.', hot: { db: 'current', 'app>db': 'accent' } },
        { note: 'Private servers reach out through the NAT gateway, which never accepts inbound connections.', hot: { nat: 'ok', 'app>nat': 'accent', 'nat>igw': 'accent' }, rows: [['outbound', 'via NAT', 'ok']] },
      ],
    },
  ],
  peering: [
    'Peering vs transit',
    {
      panel: 'VPCs',
      nodes: [
        N('a', 30, 80, 290, 110, 'VPC A', 'prod'),
        N('b', 355, 80, 290, 110, 'VPC B', 'shared'),
        N('c', 680, 80, 290, 110, 'VPC C', 'data'),
        N('tgw', 355, 420, 290, 110, 'transit gateway', 'hub', { detail: { title: 'Transit gateway', text: 'A hub that routes between many VPCs and on-prem links, instead of an N² mesh of peerings.' } }),
        N('onp', 355, 700, 290, 110, 'on-prem', 'VPN / Direct Connect'),
      ],
      edges: ['a>b', 'b>c', 'a>tgw', 'b>tgw', 'c>tgw', 'onp>tgw'],
      beats: [
        { note: 'A is peered with B, and B with C.', hot: { 'a>b': 'accent', 'b>c': 'accent' }, hide: ['tgw', 'onp'], rows: [['peerings', 2]] },
        { note: 'A still cannot reach C: peering is not transitive.', hot: { a: 'fail', c: 'fail' }, hide: ['tgw', 'onp'], rows: [['A → C', 'no route', 'fail']] },
        { note: 'With many VPCs, a transit gateway acts as the hub instead of a full mesh.', hot: { tgw: 'current', 'a>tgw': 'accent', 'b>tgw': 'accent', 'c>tgw': 'accent' }, hide: ['a>b', 'b>c', 'onp'], rows: [['A → C', 'via hub', 'ok']] },
        { note: 'On-prem networks attach to the same hub over VPN or Direct Connect.', hot: { onp: 'current', 'onp>tgw': 'accent' }, hide: ['a>b', 'b>c'] },
      ],
    },
  ],
});

const cl: Actor = { id: 'cl', label: 'Client' };
const nacl: Actor = { id: 'na', label: 'NACL', sub: 'subnet, stateless', detail: { title: 'Network ACL', text: 'Stateless and ordered: inbound and outbound are checked separately, so return traffic on ephemeral ports needs its own rule.', code: 'Rule  Type   Port        Source      Action\n100   HTTPS  443         0.0.0.0/0   ALLOW\n110   TCP    1024-65535  0.0.0.0/0   ALLOW\n*     ALL    ALL         0.0.0.0/0   DENY' } };
const sg: Actor = { id: 'sg', label: 'Security group', sub: 'instance, stateful', detail: { title: 'Security group', text: 'Stateful allow-list per instance. If inbound is allowed, the reply is allowed automatically.', code: 'Inbound: TCP 8080 from sg-alb\nOutbound: TCP 5432 to sg-db' } };
const inst: Actor = { id: 'in', label: 'App instance' };
const fw: SeqMsg[] = [
  { from: 'cl', to: 'na', label: 'SYN :443', note: 'A packet heads for an instance in a private subnet via the load balancer.' },
  { from: 'na', to: 'na', label: 'rule 100 ALLOW', kind: 'self', note: 'The subnet’s NACL evaluates rules in order; 443 is allowed.' },
  { from: 'na', to: 'sg', label: 'SYN :443', note: 'Next the instance’s security group checks it.' },
  { from: 'sg', to: 'in', label: 'allowed (from ALB SG)', note: 'Only traffic from the load balancer’s security group is let in.' },
  { from: 'in', to: 'sg', label: 'SYN-ACK', kind: 'resp', note: 'The reply leaves the instance.' },
  { from: 'sg', to: 'na', label: 'auto-allowed', kind: 'resp', note: 'Security groups are stateful, so the reply needs no outbound rule.' },
  { from: 'na', to: 'cl', label: 'rule 110 ephemeral', kind: 'resp', note: 'NACLs are stateless, so the reply to an ephemeral port needs its own rule. Forgetting it is a classic outage.' },
];
sdDemo(G, 'sd-vpc-firewalls', 'Security groups vs NACLs', 'One connection through a stateless subnet ACL and a stateful security group, packet by packet.', {
  path: ['Packet path', () => seqFrames({ actors: [cl, nacl, sg, inst], msgs: fw, intro: 'Two firewalls sit in front of every instance.', panel: 'Firewalls' })],
});
