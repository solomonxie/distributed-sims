// Lower layers (groups net-layers, net-link, net-ip): encapsulation, headers, Ethernet/ARP/switching, IP/CIDR/routing/NAT/IPv6.
import type { Detail, Frame } from '../algo/frames';
import { box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { boardFrames, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { bits32, headerFrames, intToIp, ipToInt, laneFrames, lpm, maskOf, parseCidr, subnet } from './lib';
import type { Field, Route } from './lib';

// ---------------- layers & encapsulation ----------------
const D: Record<string, Detail> = {
  app: { title: 'Application layer (L7)', text: 'Your protocol: HTTP, DNS, gRPC, SMTP. It hands the kernel a byte stream or datagram and never sees the headers below.', code: 'GET /index.html HTTP/1.1\nHost: example.com\n\n# the app writes these bytes to a socket' },
  transport: { title: 'Transport layer (L4)', text: 'TCP or UDP. Adds ports so the right process gets the data; TCP also adds sequence numbers, ACKs, flow and congestion control.', code: '$ ss -tn\nESTAB 0 0 10.0.0.5:52814 93.184.216.34:443' },
  network: { title: 'Network layer (L3)', text: 'IP. Adds source and destination addresses so routers can forward the packet hop by hop across networks. Also TTL and protocol number.', code: '$ ip route get 93.184.216.34\n93.184.216.34 via 10.0.0.1 dev eth0 src 10.0.0.5' },
  link: { title: 'Link layer (L2)', text: 'Ethernet or Wi-Fi. Adds MAC addresses for the next hop only, plus a checksum (FCS). Rewritten at every router.', code: '$ ip link show eth0\n2: eth0: <UP> mtu 1500\n    link/ether 02:42:ac:11:00:02' },
  physical: { title: 'Physical layer (L1)', text: 'Bits as voltage, light or radio. The NIC and cable or antenna; nothing here knows about addresses.' },
  payload: { title: 'Payload', text: 'The bytes the layer above handed down. Each layer treats everything above it as opaque payload.' },
  eth: { title: 'Ethernet header (14 B)', text: 'Destination MAC, source MAC and EtherType (0x0800 = IPv4, 0x86DD = IPv6). The FCS trailer (4 B) catches bit errors on this one link.', code: '$ tcpdump -e -n -c1\n02:42:ac:11:00:02 > 02:42:ac:11:00:01,\n  ethertype IPv4 (0x0800), length 74' },
  ip: { title: 'IPv4 header (20 B)', text: 'Source and destination IP, TTL, protocol (6 = TCP, 17 = UDP) and total length. Routers read only this far.' },
  tcp: { title: 'TCP header (20 B+)', text: 'Ports, sequence and acknowledgement numbers, flags (SYN, ACK, FIN, RST), receive window. Options (MSS, SACK, timestamps) add up to 40 B.' },
  fcs: { title: 'FCS (4 B)', text: 'Frame check sequence: a CRC-32 over the frame. A bad FCS means the NIC silently drops the frame; TCP will retransmit.' },
};

const LAYERS: BoardNode2[] = [
  ['app', 'Application', 'HTTP, DNS, TLS'],
  ['transport', 'Transport', 'TCP, UDP · ports'],
  ['network', 'Network', 'IP · addresses'],
  ['link', 'Link', 'Ethernet · MAC'],
  ['physical', 'Physical', 'bits on a wire'],
];
type BoardNode2 = [id: string, label: string, sub: string];

const stackBoard: Board = {
  panel: 'Layers',
  nodes: [
    ...LAYERS.map(([id, label, sub], i) => N(id, 380, 60 + i * 150, 580, 120, label, sub, { detail: D[id] })),
    N('o7', 40, 60, 300, 120, 'OSI 5–7', 'session, presentation, app'),
    N('o4', 40, 210, 300, 120, 'OSI 4'),
    N('o3', 40, 360, 300, 120, 'OSI 3'),
    N('o2', 40, 510, 300, 120, 'OSI 2'),
    N('o1', 40, 660, 300, 120, 'OSI 1'),
    N('pdu', 40, 830, 920, 120, 'PDU names', 'data → segment → packet → frame → bits'),
  ],
  edges: ['app>transport', 'transport>network', 'network>link', 'link>physical'],
  beats: [
    { note: 'The internet runs on the 4-layer TCP/IP model; the 7-layer OSI model is the vocabulary people use to talk about it.', hide: ['pdu'], rows: [['TCP/IP layers', 4], ['OSI layers', 7]] },
    { note: 'OSI 5 to 7 collapse into one application layer in practice. TLS sits between them, depending on who you ask.', hot: { app: 'current', o7: 'current' }, hide: ['pdu'], rows: [['L7', 'HTTP, DNS, gRPC']] },
    { note: 'Each layer only talks to its peer layer on the other side, using headers the layer below carries as payload.', hot: { transport: 'current', network: 'current', link: 'current' }, hide: ['pdu'], rows: [['L4', 'ports'], ['L3', 'IP addresses'], ['L2', 'MAC addresses']] },
    { note: 'Each layer gives its unit a name: segment at L4, packet at L3, frame at L2.', hot: { pdu: 'current' }, rows: [['"L4 load balancer"', 'routes by IP + port'], ['"L7 load balancer"', 'routes by URL, headers']] },
  ],
};

const encapNodes = (o: { mss?: boolean } = {}) => [
  N('p', 560, 60, 400, 100, 'payload', o.mss ? '1460 B (MSS)' : 'GET / …', { detail: D.payload }),
  N('t', 360, 220, 180, 100, 'TCP', '20 B', { detail: D.tcp }),
  N('p2', 560, 220, 400, 100, 'payload', 'segment', { detail: D.payload }),
  N('i', 160, 380, 180, 100, 'IP', '20 B', { detail: D.ip }),
  N('t2', 360, 380, 180, 100, 'TCP'),
  N('p3', 560, 380, 400, 100, 'payload', 'packet'),
  N('e', 20, 540, 120, 100, 'Eth', '14 B', { detail: D.eth }),
  N('i2', 160, 540, 180, 100, 'IP'),
  N('t3', 360, 540, 180, 100, 'TCP'),
  N('p4', 560, 540, 300, 100, 'payload', 'frame'),
  N('f', 870, 540, 110, 100, 'FCS', '4 B', { detail: D.fcs }),
  N('wire', 20, 720, 960, 110, '10110010 01001110 …', 'bits on the wire'),
  N('sum', 20, 860, 960, 110, 'overhead', ''),
];

const encapBoard: Board = {
  panel: 'Encapsulation',
  nodes: encapNodes(),
  edges: ['p>p2', 'p2>p3', 'p3>p4', 'p4>wire'],
  beats: [
    { note: 'The app writes bytes to a socket. To the kernel they are just payload.', hot: { p: 'current' }, hide: ['t', 'p2', 'i', 't2', 'p3', 'e', 'i2', 't3', 'p4', 'f', 'wire', 'sum'], rows: [['bytes', 'payload only']] },
    { note: 'TCP prepends its 20-byte header: ports, sequence number, flags. Now it is a segment.', hot: { t: 'current', p2: 'write' }, hide: ['i', 't2', 'p3', 'e', 'i2', 't3', 'p4', 'f', 'wire', 'sum'], rows: [['headers', '20 B']] },
    { note: 'IP prepends source and destination addresses and a TTL. Now it is a packet that routers can forward.', hot: { i: 'current', p3: 'write' }, hide: ['e', 'i2', 't3', 'p4', 'f', 'wire', 'sum'], rows: [['headers', '40 B']] },
    { note: 'Ethernet wraps it with MACs for the next hop and a CRC trailer. Now it is a frame.', hot: { e: 'current', f: 'current', p4: 'write' }, hide: ['wire', 'sum'], rows: [['headers', '58 B']] },
    { note: 'The NIC serialises the frame to bits. The receiver peels the layers off in reverse order.', hot: { wire: 'current' }, sub: { sum: '14 + 20 + 20 + 4 = 58 B around your data' }, rows: [['overhead', '58 B / frame']] },
  ],
};

const mtuBoard: Board = {
  panel: 'MTU',
  nodes: encapNodes({ mss: true }),
  edges: ['p>p2', 'p2>p3', 'p3>p4', 'p4>wire'],
  beats: [
    { note: 'Ethernet frames carry at most 1500 bytes of IP packet: the MTU.', hot: { p4: 'current' }, sub: { p4: '≤ 1500 B IP packet', sum: 'MTU 1500' }, rows: [['MTU', '1500 B']] },
    { note: 'Minus 20 B IP and 20 B TCP leaves 1460 B of payload per segment, the MSS, agreed in the SYN.', hot: { p: 'current', t: 'write', i: 'write' }, sub: { sum: 'MSS = 1500 − 20 − 20 = 1460' }, rows: [['MSS', '1460 B']] },
    { note: 'A 1 MB response is about 719 segments. Headers cost 2.7%, plus the 38 B of Ethernet preamble and gap.', hot: { sum: 'current' }, sub: { sum: '1,048,576 / 1460 ≈ 719 segments' }, rows: [['segments / MB', 719]] },
    { note: 'Tunnels (VPN, VXLAN) add headers and shrink the usable MTU. If ICMP is blocked, big packets vanish: an MTU black hole.', hot: { wire: 'fail', sum: 'fail' }, sub: { sum: 'VXLAN: 1500 − 50 = 1450 inner MTU' }, rows: [['symptom', 'small requests work, big ones hang', 'fail']] },
  ],
};

const decapBoard: Board = {
  panel: 'Receive path',
  nodes: encapNodes(),
  edges: ['p4>wire'],
  beats: [
    { note: 'The NIC checks the FCS and the destination MAC. Frames for other MACs are dropped here.', hot: { e: 'current', f: 'current' }, hide: ['sum'], rows: [['L2 check', 'MAC + CRC']] },
    { note: 'IP checks the destination address and protocol field, then hands the payload to TCP.', hot: { i2: 'current' }, hide: ['sum'], rows: [['L3 check', 'dst IP ours?']] },
    { note: 'TCP finds the socket by the 4-tuple, reorders by sequence number and ACKs.', hot: { t3: 'current' }, hide: ['sum'], rows: [['socket lookup', 'src ip:port, dst ip:port']] },
    { note: 'Only the payload reaches recv(). The app never sees a header.', hot: { p: 'ok' }, hide: ['sum'], rows: [['app sees', 'bytes', 'ok']] },
  ],
};

machineDemo({
  slug: 'nw-encap',
  title: 'Layers & encapsulation',
  group: 'net-layers',
  summary: 'OSI vs TCP/IP, wrapping payload into segment → packet → frame, MTU and MSS, the receive path.',
  inputs: [
    { id: 'stack', label: 'The layer model', data: { b: 'stack' } },
    { id: 'encap', label: 'Encapsulation', data: { b: 'encap' } },
    { id: 'mtu', label: 'MTU & MSS', data: { b: 'mtu' } },
    { id: 'decap', label: 'Receive path', data: { b: 'decap' } },
  ],
  build: ({ b }: { b: string }) => boardFrames({ stack: stackBoard, encap: encapBoard, mtu: mtuBoard, decap: decapBoard }[b]!),
});

// ---------------- header byte layouts ----------------
const FD = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const HEADERS: Record<string, { title: string; fields: Field[]; steps: { note: string; hl: number[]; rows?: [string, string | number][] }[] }> = {
  ipv4: {
    title: 'IPv4 header',
    fields: [
      { name: 'ver', bits: 4, value: '4', detail: FD('Version', 'Always 4 for IPv4.') },
      { name: 'IHL', bits: 4, value: '5', detail: FD('Header length', 'In 32-bit words; 5 means 20 bytes, no options.') },
      { name: 'DSCP/ECN', bits: 8, value: '0', detail: FD('DSCP / ECN', 'Traffic class for QoS, and Explicit Congestion Notification bits routers set instead of dropping.') },
      { name: 'total length', bits: 16, value: '60', detail: FD('Total length', 'Header + payload in bytes, max 65535.') },
      { name: 'identification', bits: 16, value: '0x1c46', detail: FD('Identification', 'Groups fragments of one packet.') },
      { name: 'flags', bits: 3, value: 'DF', detail: FD('Flags', 'DF = do not fragment. With DF set, a too-big packet is dropped and an ICMP "fragmentation needed" is sent back (path MTU discovery).') },
      { name: 'fragment offset', bits: 13, value: '0' },
      { name: 'TTL', bits: 8, value: '64', detail: FD('Time to live', 'Decremented by every router; at 0 the packet is dropped and ICMP time-exceeded is returned. traceroute is built on this.', '$ ping -t 1 8.8.8.8   # macOS: TTL 1\nFrom 10.0.0.1: Time to live exceeded') },
      { name: 'protocol', bits: 8, value: '6 (TCP)', detail: FD('Protocol', '6 = TCP, 17 = UDP, 1 = ICMP. Tells the receiver which L4 handler gets the payload.') },
      { name: 'checksum', bits: 16, value: '0xb1e6', detail: FD('Header checksum', 'Covers only the header; recomputed at every hop because TTL changes.') },
      { name: 'source address', bits: 32, value: '10.0.0.5', detail: FD('Source IP', 'Who sent it. NAT rewrites this on the way out.') },
      { name: 'destination address', bits: 32, value: '93.184.216.34', detail: FD('Destination IP', 'Where it goes. Routers look only at this to pick the next hop.') },
    ],
    steps: [
      { note: 'An IPv4 header is 20 bytes without options, drawn 32 bits per row as in RFC 791.', hl: [], rows: [['size', '20 B']] },
      { note: 'Routers care about three fields: destination, TTL and checksum.', hl: [7, 9, 11], rows: [['per hop', 'TTL−1, new checksum']] },
      { note: 'Protocol says who gets the payload; 6 means TCP.', hl: [8], rows: [['protocol', '6 = TCP']] },
      { note: 'Flags and offset handle fragmentation. Modern stacks set DF and rely on path MTU discovery instead.', hl: [4, 5, 6], rows: [['DF', 'set']] },
      { note: 'Source and destination are the 32-bit addresses. NAT rewrites the source on the way out.', hl: [10, 11], rows: [['src', '10.0.0.5'], ['dst', '93.184.216.34']] },
    ],
  },
  tcp: {
    title: 'TCP header',
    fields: [
      { name: 'source port', bits: 16, value: '52814', detail: FD('Source port', 'The client picks an ephemeral port (Linux: 32768–60999).', '$ cat /proc/sys/net/ipv4/ip_local_port_range\n32768\t60999') },
      { name: 'destination port', bits: 16, value: '443', detail: FD('Destination port', 'The service: 443 HTTPS, 5432 Postgres, 6379 Redis.') },
      { name: 'sequence number', bits: 32, value: '1000', detail: FD('Sequence number', 'Byte offset of this segment\'s first byte in the stream, starting from a random ISN chosen in the SYN.') },
      { name: 'acknowledgement number', bits: 32, value: '5001', detail: FD('ACK number', 'Next byte the sender expects from the other side. Cumulative: ACK 5001 confirms everything before byte 5001.') },
      { name: 'off', bits: 4, value: '5' },
      { name: 'rsv', bits: 4, value: '0' },
      { name: 'flags', bits: 8, value: 'ACK PSH', detail: FD('Flags', 'SYN opens, FIN closes, RST aborts, ACK says the ack field is valid, PSH asks to deliver now.', '$ tcpdump -n "tcp[tcpflags] & tcp-syn != 0"') },
      { name: 'window', bits: 16, value: '65535', detail: FD('Receive window', 'How many more bytes the receiver can buffer. Scaled by the window-scale option, so real windows reach megabytes.') },
      { name: 'checksum', bits: 16, value: '0x9f3c' },
      { name: 'urgent ptr', bits: 16, value: '0' },
    ],
    steps: [
      { note: 'A TCP header is 20 bytes plus up to 40 bytes of options.', hl: [], rows: [['size', '20–60 B']] },
      { note: 'Ports pick the process. The 4-tuple of IPs and ports identifies the connection.', hl: [0, 1], rows: [['4-tuple', '10.0.0.5:52814 → :443']] },
      { note: 'Sequence and ACK numbers count bytes, not packets. They are what make TCP reliable and ordered.', hl: [2, 3], rows: [['seq', 1000], ['ack', 5001]] },
      { note: 'Flags drive the state machine: SYN, ACK, FIN, RST.', hl: [6], rows: [['flags', 'ACK PSH']] },
      { note: 'The window is flow control: the receiver tells the sender how much room it has left.', hl: [7], rows: [['rwnd', '65535 × scale']] },
    ],
  },
  udp: {
    title: 'UDP header',
    fields: [
      { name: 'source port', bits: 16, value: '51000' },
      { name: 'destination port', bits: 16, value: '53 (DNS)', detail: FD('Destination port', 'DNS on 53, QUIC on 443, NTP on 123.') },
      { name: 'length', bits: 16, value: '40', detail: FD('Length', 'Header + data in bytes.') },
      { name: 'checksum', bits: 16, value: '0x3a1f', detail: FD('Checksum', 'Optional in IPv4, mandatory in IPv6.') },
    ],
    steps: [
      { note: 'UDP is 8 bytes: ports, length, checksum. That is the whole protocol.', hl: [], rows: [['size', '8 B']] },
      { note: 'No sequence numbers, no ACKs, no connection. Each datagram stands alone.', hl: [0, 1], rows: [['reliability', 'none']] },
      { note: 'That is why DNS, games, VoIP and QUIC build on it: they add only the guarantees they need.', hl: [2, 3], rows: [['built on UDP', 'DNS, QUIC, RTP']] },
    ],
  },
  eth: {
    title: 'Ethernet II frame header',
    fields: [
      { name: 'destination MAC', bits: 48, value: '02:42:ac:11:00:01', detail: FD('Destination MAC', 'The next hop, not the final host: usually your default gateway. ff:ff:ff:ff:ff:ff is broadcast.') },
      { name: 'source MAC', bits: 48, value: '02:42:ac:11:00:02', detail: FD('Source MAC', 'This NIC\'s burned-in (or virtual) address.') },
      { name: 'EtherType', bits: 16, value: '0x0800 IPv4', detail: FD('EtherType', '0x0800 IPv4, 0x86DD IPv6, 0x0806 ARP, 0x8100 VLAN tag.') },
    ],
    steps: [
      { note: 'An Ethernet header is 14 bytes: two MAC addresses and a type.', hl: [], rows: [['size', '14 B + 4 B FCS']] },
      { note: 'MACs are only for this hop. Every router strips the frame and builds a new one.', hl: [0, 1], rows: [['scope', 'one link']] },
      { note: 'EtherType tells the receiver which protocol is inside.', hl: [2], rows: [['0x0800', 'IPv4']] },
    ],
  },
};

machineDemo({
  slug: 'nw-headers',
  title: 'Header byte layouts',
  group: 'net-layers',
  summary: 'IPv4, TCP, UDP and Ethernet headers field by field, 32 bits per row like the RFCs.',
  inputs: Object.keys(HEADERS).map((id) => ({ id, label: HEADERS[id].title, data: { h: id } })),
  build: ({ h }: { h: string }) => {
    const H = HEADERS[h];
    return headerFrames(H.title, H.fields, H.steps, 'Header');
  },
});

// ---------------- Ethernet, ARP, switching ----------------
const LD: Record<string, Detail> = {
  A: { title: 'Host A', text: '10.0.0.5, MAC aa:aa. Knows B\'s IP but not its MAC, and frames need a MAC.', code: '$ ip neigh\n10.0.0.1 dev eth0 lladdr 02:42:0a:00:00:01 REACHABLE' },
  B: { title: 'Host B', text: '10.0.0.9, MAC bb:bb. Replies to ARP requests for its own IP.' },
  sw: { title: 'Switch', text: 'Forwards frames by destination MAC using a MAC table it learns from source MACs. Unknown or broadcast destinations are flooded to every port.', code: '# Linux bridge equivalent\n$ bridge fdb show br0\naa:aa:aa:aa:aa:aa dev port1 master br0' },
  gw: { title: 'Default gateway', text: 'The router for this subnet. Anything off-subnet is sent to its MAC, with the final IP unchanged.', code: '$ ip route\ndefault via 10.0.0.1 dev eth0\n10.0.0.0/24 dev eth0 proto kernel' },
};

const arpLanes = (gateway: boolean): Frame[] =>
  laneFrames({
    lanes: ['Host A', 'Switch', gateway ? 'Router' : 'Host B'],
    subs: ['10.0.0.5 · aa:aa', 'learns MACs', gateway ? '10.0.0.1 · 11:11' : '10.0.0.9 · bb:bb'],
    laneDetails: [LD.A, LD.sw, gateway ? LD.gw : LD.B],
    panel: 'ARP',
    intro: gateway ? 'A sends to 8.8.8.8, which is off its /24. It must hand the frame to the gateway.' : 'A wants to send an IP packet to 10.0.0.9 on its own subnet. It knows the IP but not the MAC.',
    rows: [['ARP cache', 'empty']],
    msgs: [
      { from: 0, to: 0, label: gateway ? 'route: via 10.0.0.1' : 'dst in 10.0.0.0/24', note: gateway ? 'The routing table says: default via 10.0.0.1. So A needs the gateway\'s MAC, not Google\'s.' : 'Same subnet, so A can deliver directly on the link.', tone: 'warn' },
      { from: 0, to: 1, label: `who has ${gateway ? '10.0.0.1' : '10.0.0.9'}?`, note: 'A broadcasts an ARP request to ff:ff:ff:ff:ff:ff.', detail: { title: 'ARP request', text: 'A broadcast frame (EtherType 0x0806) asking who owns an IP. Every host on the segment receives it.', code: '$ tcpdump -n arp\nARP, Request who-has 10.0.0.9 tell 10.0.0.5' } },
      { from: 1, to: 2, label: 'flood (broadcast)', note: 'The switch floods broadcasts to every port, so every host in the VLAN sees it.' },
      { from: 2, to: 1, label: `${gateway ? '10.0.0.1 is 11:11' : '10.0.0.9 is bb:bb'}`, note: 'The owner answers with a unicast ARP reply.', detail: { title: 'ARP reply', text: 'Unicast back to the asker with the MAC. A caches it for a few minutes.', code: 'ARP, Reply 10.0.0.9 is-at bb:bb:bb:bb:bb:bb' } },
      { from: 1, to: 0, label: 'reply', note: 'A stores the mapping in its ARP cache.', rows: [['ARP cache', gateway ? '10.0.0.1 → 11:11' : '10.0.0.9 → bb:bb', 'ok']] },
      { from: 0, to: 2, label: gateway ? 'IP dst 8.8.8.8 · MAC 11:11' : 'IP 10.0.0.9 · MAC bb:bb', note: gateway ? 'The frame goes to the router\'s MAC while the IP still says 8.8.8.8. The router re-frames it for its next hop.' : 'Now the real frame goes straight to B.', tone: 'ok', rows: [['ARP cache', gateway ? '10.0.0.1 → 11:11' : '10.0.0.9 → bb:bb', 'ok']] },
    ],
    outro: gateway ? 'MACs change every hop, IPs stay end to end. That split is the whole idea of layering.' : 'ARP costs one round trip the first time, then the cache answers. Stale entries after an IP move cause mysterious outages.',
  });

const switchBoard: Board = {
  panel: 'MAC table',
  nodes: [
    N('sw', 330, 380, 340, 140, 'switch', 'MAC table', { detail: LD.sw }),
    N('a', 40, 80, 260, 110, 'A · aa:aa', 'port 1'),
    N('b', 700, 80, 260, 110, 'B · bb:bb', 'port 2'),
    N('c', 40, 700, 260, 110, 'C · cc:cc', 'port 3'),
    N('d', 700, 700, 260, 110, 'D · dd:dd', 'port 4'),
    N('tbl', 330, 580, 340, 330, 'table', 'empty'),
  ],
  edges: ['a>sw', 'sw>b', 'sw>c', 'sw>d'],
  beats: [
    { note: 'A fresh switch knows nothing. A sends a frame to B.', hot: { a: 'current' }, rows: [['entries', 0]] },
    { note: 'The switch learns aa:aa is on port 1 from the source MAC. B is unknown, so it floods to every other port.', hot: { 'a>sw': 'accent', 'sw>b': 'accent', 'sw>c': 'warn', 'sw>d': 'warn' }, sub: { tbl: 'aa:aa → 1' }, rows: [['entries', 1], ['flooded', 'yes', 'warn']] },
    { note: 'B replies. The switch learns bb:bb on port 2 and forwards only to port 1.', hot: { b: 'current', 'sw>b': 'accent' }, sub: { tbl: 'aa:aa → 1 · bb:bb → 2' }, rows: [['entries', 2], ['flooded', 'no', 'ok']] },
    { note: 'From now on A and B talk privately; C and D see nothing. Entries age out after about 5 minutes.', hot: { a: 'ok', b: 'ok', c: 'visited', d: 'visited' }, sub: { tbl: 'aa:aa → 1 · bb:bb → 2' }, rows: [['aging', '300 s']] },
  ],
};

const vlanBoard: Board = {
  panel: 'VLANs',
  nodes: [
    N('s1', 60, 400, 340, 140, 'switch 1', 'trunk port 24'),
    N('s2', 600, 400, 340, 140, 'switch 2', 'trunk port 24'),
    N('w1', 40, 80, 200, 110, 'web-1', 'VLAN 10'),
    N('d1', 250, 80, 200, 110, 'db-1', 'VLAN 20'),
    N('w2', 560, 80, 200, 110, 'web-2', 'VLAN 10'),
    N('d2', 770, 80, 200, 110, 'db-2', 'VLAN 20'),
    N('tag', 200, 700, 600, 140, '802.1Q tag', '4 bytes · VLAN id 12 bits', { detail: { title: '802.1Q VLAN tag', text: 'Inserted after the source MAC on trunk links: EtherType 0x8100 then a 12-bit VLAN id (up to 4094 VLANs).', code: '$ ip link add link eth0 name eth0.10 type vlan id 10' } }),
  ],
  edges: ['w1>s1', 'd1>s1', 'w2>s2', 'd2>s2', 's1>s2'],
  beats: [
    { note: 'VLANs split one physical switch into several isolated L2 networks.', hot: { w1: 'read', w2: 'read', d1: 'write', d2: 'write' }, hide: ['tag'], rows: [['VLANs', 2]] },
    { note: 'A broadcast from web-1 in VLAN 10 reaches web-2 only. db-1 never sees it.', hot: { w1: 'current', w2: 'ok', 'w1>s1': 'accent', 's1>s2': 'accent', 'w2>s2': 'accent', d1: 'visited', d2: 'visited' }, hide: ['tag'], rows: [['broadcast domain', 'VLAN 10 only']] },
    { note: 'Between switches, a trunk carries all VLANs by tagging each frame with its VLAN id.', hot: { tag: 'current', 's1>s2': 'accent' }, rows: [['tag', '0x8100 · id 10']] },
    { note: 'Crossing VLANs needs a router. That is where firewall rules between tiers live.', hot: { tag: 'ok' }, rows: [['web → db', 'via router + ACL']] },
  ],
};

machineDemo({
  slug: 'nw-link',
  title: 'Ethernet, ARP & switching',
  group: 'net-link',
  summary: 'ARP resolves IP → MAC, switches learn MAC tables and flood unknowns, VLANs and trunks, sending via the default gateway.',
  inputs: [
    { id: 'arp', label: 'ARP on a subnet', data: { k: 'arp' } },
    { id: 'switch', label: 'Switch learning', data: { k: 'switch' } },
    { id: 'vlan', label: 'VLANs & trunks', data: { k: 'vlan' } },
    { id: 'gateway', label: 'Via the gateway', data: { k: 'gateway' } },
  ],
  build: ({ k }: { k: string }) => (k === 'arp' ? arpLanes(false) : k === 'gateway' ? arpLanes(true) : boardFrames(k === 'switch' ? switchBoard : vlanBoard)),
});

// ---------------- CIDR ----------------
function cidrFrames(cidr: string, probe: string): Frame[] {
  const s = subnet(cidr);
  const { net, len } = parseCidr(cidr);
  const f = new Film();
  const ip = ipToInt(probe);
  const inside = ((ip & maskOf(len)) >>> 0) === net;
  const rowOf = (id: string, y: number, label: string, v: number, split: number, tone: 'read' | 'write' | 'ok' | 'fail' | 'default' = 'default') => {
    const b = bits32(v);
    const out = [text(`${id}l`, 20, y - 26, `${label}  ${intToIp(v)}`, { align: 'left', size: 26, mono: true, bold: true })];
    for (let i = 0; i < 32; i++) out.push(box(`${id}${i}`, 20 + i * 30 + (i >= 8 ? 4 : 0) + (i >= 16 ? 4 : 0) + (i >= 24 ? 4 : 0), y, 26, 56, b[i], { mono: true, tone: i < split ? tone : 'default', filled: i < split }));
    return out;
  };
  const dm = (title: string, text: string, code?: string) => ({ title, text, code });
  const summary = (show: number) => {
    const rows = [
      ['network', s.network],
      ['mask', s.mask],
      ['broadcast', s.broadcast],
      ['usable', `${s.first} – ${s.last}`],
      ['hosts', String(s.hosts)],
    ].slice(0, show) as [string, string][];
    return rows;
  };
  const card = (show: number) => {
    const b = box('card', 20, 760, 960, 200, `${cidr}`, { sub: `${s.hosts} usable hosts · ${s.first} – ${s.last}`, mono: true, tone: show ? 'ok' : 'default' });
    if (b.t === 'rect') b.detail = dm(`${cidr}`, `A /${len} fixes the first ${len} bits as the network; the other ${32 - len} bits number hosts. The first address names the network and the last is broadcast, so ${s.size} − 2 = ${s.hosts} usable (except /31, /32).`, `$ ipcalc ${cidr}\nNetwork:   ${s.network}/${len}\nNetmask:   ${s.mask}\nBroadcast: ${s.broadcast}\nHostMin:   ${s.first}\nHostMax:   ${s.last}\nHosts/Net: ${s.hosts}`);
    return b;
  };
  f.add(`${cidr}: the /${len} means the first ${len} bits are the network part.`, [...rowOf('a', 120, 'address', net, len, 'read'), card(0)], panel('CIDR', [['prefix', `/${len}`], ['host bits', 32 - len]]));
  f.add(`The mask is ${len} ones then ${32 - len} zeros: ${s.mask}.`, [...rowOf('a', 120, 'address', net, len, 'read'), ...rowOf('m', 300, 'mask', maskOf(len), len, 'write'), card(0)], panel('CIDR', summary(2)));
  f.add(`All host bits set gives the broadcast address, ${s.broadcast}.`, [...rowOf('a', 120, 'network', net, len, 'read'), ...rowOf('m', 300, 'mask', maskOf(len), len, 'write'), ...rowOf('b', 480, 'broadcast', ipToInt(s.broadcast), len, 'read'), card(1)], panel('CIDR', summary(5)));
  f.add(`Is ${probe} inside? AND it with the mask and compare with the network.`, [...rowOf('a', 120, 'network', net, len, 'read'), ...rowOf('m', 300, 'mask', maskOf(len), len, 'write'), ...rowOf('p', 480, 'probe', ip, len, inside ? 'ok' : 'fail'), card(1)], panel('CIDR', [['probe & mask', intToIp((ip & maskOf(len)) >>> 0)], ['inside', inside ? 'yes' : 'no', inside ? 'ok' : 'fail']]));
  return f.frames;
}

machineDemo({
  slug: 'nw-cidr',
  title: 'CIDR & subnets',
  group: 'net-ip',
  summary: 'Prefix length, netmask, network and broadcast addresses, host counts and membership checks bit by bit.',
  inputs: [
    { id: '24', label: '10.1.2.0/24', data: { cidr: '10.1.2.0/24', probe: '10.1.2.77' } },
    { id: '26', label: '192.168.1.64/26', data: { cidr: '192.168.1.64/26', probe: '192.168.1.130' } },
    { id: '16', label: '172.16.0.0/12', data: { cidr: '172.16.0.0/12', probe: '172.31.255.1' } },
  ],
  build: ({ cidr, probe }: { cidr: string; probe: string }) => cidrFrames(cidr, probe),
});

// ---------------- routing ----------------
const TABLE: Route[] = [
  { prefix: '0.0.0.0/0', via: '203.0.113.1 (ISP)' },
  { prefix: '10.0.0.0/8', via: '10.255.0.1 (VPN)' },
  { prefix: '10.1.0.0/16', via: '10.1.0.1 (DC east)' },
  { prefix: '10.1.2.0/24', via: 'eth1 (direct)' },
];

function routeFrames(dst: string): Frame[] {
  const { route, matches } = lpm(TABLE, dst);
  const f = new Film();
  const draw = (stage: number) => {
    const out = [text('q', 20, 50, `route lookup: dst ${dst}`, { align: 'left', size: 30, bold: true, mono: true })];
    TABLE.forEach((r, i) => {
      const m = matches.includes(r);
      const win = r === route;
      const tone = stage === 0 ? 'default' : stage === 1 ? (m ? 'read' : 'visited') : win ? 'ok' : m ? 'visited' : 'visited';
      const b = box(`r${i}`, 20, 120 + i * 130, 960, 110, `${r.prefix.padEnd(14)} → ${r.via}`, { mono: true, tone, sub: stage >= 1 ? (m ? `matches · /${parseCidr(r.prefix).len}` : 'no match') : undefined });
      if (b.t === 'rect') b.detail = { title: `Route ${r.prefix}`, text: `Packets whose destination falls inside ${r.prefix} go ${r.via}. Longer prefixes are more specific.`, code: `$ ip route add ${r.prefix} via …` };
      out.push(b);
    });
    const res = box('res', 20, 680, 960, 150, stage >= 2 ? (route ? `next hop: ${route.via}` : 'no route: ICMP unreachable') : '?', { tone: stage >= 2 ? (route ? 'ok' : 'fail') : 'default', mono: true, sub: stage >= 2 ? 'longest prefix wins' : undefined });
    if (res.t === 'rect') res.detail = { title: 'Longest-prefix match', text: 'Every router, and your laptop, picks the most specific matching route. The default route 0.0.0.0/0 matches everything, so it wins only when nothing else does.', code: `$ ip route get ${dst}` };
    out.push(res);
    return out;
  };
  f.add('The kernel\'s routing table: prefixes and where to send matching packets.', draw(0), panel('Routing', [['routes', TABLE.length]]));
  f.add(`Every prefix containing ${dst} matches: ${matches.length} of ${TABLE.length}.`, draw(1), panel('Routing', [['matches', matches.length]]));
  f.add(`The longest prefix is the most specific, so it wins: ${route?.prefix}.`, draw(2), panel('Routing', [['winner', route?.prefix ?? '—', 'ok'], ['next hop', route?.via ?? '—']]));
  return f.frames;
}

const traceLanes = (): Frame[] =>
  laneFrames({
    lanes: ['you', 'router 1', 'router 2', 'server'],
    subs: ['10.0.0.5', '10.0.0.1', '72.14.215.85', '8.8.8.8'],
    laneDetails: [undefined, { title: 'Hop 1', text: 'Your default gateway. It decrements TTL; at 0 it drops the packet and sends ICMP time exceeded back.' }, { title: 'Hop 2', text: 'An ISP or transit router. Some routers rate-limit or never answer ICMP, shown as * * * in traceroute.' }, { title: 'Destination', text: 'The final host answers with an ICMP port unreachable (UDP probes) or echo reply.' }],
    panel: 'traceroute',
    intro: 'traceroute finds the path by sending probes with TTL 1, 2, 3 and so on.',
    msgs: [
      { from: 0, to: 1, label: 'TTL=1', note: 'Probe with TTL 1 dies at the first router.' },
      { from: 1, to: 0, label: 'ICMP time exceeded', note: 'Router 1 reports back, revealing its address and the round-trip time.', tone: 'warn', rows: [['hop 1', '10.0.0.1 · 1.2 ms']] },
      { from: 0, to: 2, label: 'TTL=2', note: 'TTL 2 survives one hop and dies at router 2.' },
      { from: 2, to: 0, label: 'ICMP time exceeded', note: 'Router 2 answers from its own address.', tone: 'warn', rows: [['hop 2', '72.14.215.85 · 9.8 ms']] },
      { from: 0, to: 3, label: 'TTL=3', note: 'TTL 3 reaches the server.' },
      { from: 3, to: 0, label: 'reply', note: 'The destination answers, so traceroute stops.', tone: 'ok', rows: [['hop 3', '8.8.8.8 · 11.4 ms', 'ok']] },
    ],
    outro: 'Each hop\'s latency is a full round trip to that hop. A jump in the numbers shows where distance or congestion is.',
    outroRows: [['hops', 3], ['total', '11.4 ms']],
  });

machineDemo({
  slug: 'nw-routing',
  title: 'Routing & traceroute',
  group: 'net-ip',
  summary: 'Longest-prefix match in a routing table, the default route, and how TTL + ICMP reveal the path.',
  inputs: [
    { id: 'lpm', label: 'Longest prefix', data: { k: 'lpm', dst: '10.1.2.3' } },
    { id: 'vpn', label: 'Less specific', data: { k: 'lpm', dst: '10.7.0.9' } },
    { id: 'default', label: 'Default route', data: { k: 'lpm', dst: '8.8.8.8' } },
    { id: 'traceroute', label: 'traceroute', data: { k: 'trace' } },
  ],
  build: ({ k, dst }: { k: string; dst?: string }) => (k === 'trace' ? traceLanes() : routeFrames(dst!)),
});

// ---------------- NAT & IPv6 ----------------
const NATD: Detail = { title: 'NAT table', text: 'The router rewrites private source addresses to its one public IP and remembers each mapping by port, so replies can be sent back.', code: '$ conntrack -L -p tcp\ntcp ESTABLISHED src=192.168.1.20 sport=52814\n  dst=93.184.216.34 dport=443\n  src=93.184.216.34 dst=198.51.100.7 dport=40001' };

const natBoard = (k: string): Board => ({
  panel: 'NAT',
  nodes: [
    N('l1', 40, 80, 260, 110, 'laptop', '192.168.1.20'),
    N('l2', 40, 260, 260, 110, 'phone', '192.168.1.21'),
    N('rt', 380, 170, 260, 130, 'home router', 'public 198.51.100.7', { detail: NATD }),
    N('srv', 720, 170, 260, 130, 'server', '93.184.216.34:443'),
    N('tbl', 40, 460, 920, 200, 'NAT table', '—', { detail: NATD }),
    N('note', 40, 720, 920, 200, '', ''),
  ],
  edges: ['l1>rt', 'l2>rt', 'rt>srv'],
  beats:
    k === 'snat'
      ? [
          { note: 'Private addresses (10/8, 172.16/12, 192.168/16) are not routable on the internet.', hot: { l1: 'current', l2: 'current' }, hide: ['note'], rows: [['public IPs', 1]] },
          { note: 'The laptop connects out. The router rewrites src 192.168.1.20:52814 to 198.51.100.7:40001.', hot: { 'l1>rt': 'accent', rt: 'current', 'rt>srv': 'accent' }, sub: { tbl: '192.168.1.20:52814 ↔ :40001' }, hide: ['note'], rows: [['mappings', 1]] },
          { note: 'The phone connects to the same server. It gets a different public port.', hot: { 'l2>rt': 'accent', rt: 'current' }, sub: { tbl: '…:52814 ↔ :40001 · 192.168.1.21:52814 ↔ :40002' }, hide: ['note'], rows: [['mappings', 2]] },
          { note: 'The server sees two connections from one IP. Rate limits by IP punish everyone behind the NAT.', hot: { srv: 'warn' }, label: { note: 'server sees 198.51.100.7 ×2' }, rows: [['distinct client IPs', 1, 'warn']] },
        ]
      : k === 'return'
        ? [
            { note: 'The reply arrives addressed to 198.51.100.7:40001.', hot: { srv: 'current', 'rt>srv': 'accent' }, sub: { tbl: '192.168.1.20:52814 ↔ :40001' }, hide: ['note'], rows: [['dst', ':40001']] },
            { note: 'The router looks up port 40001 and rewrites the destination back to the laptop.', hot: { tbl: 'current', rt: 'current' }, sub: { tbl: '192.168.1.20:52814 ↔ :40001' }, hide: ['note'], rows: [['rewrite', '→ 192.168.1.20:52814']] },
            { note: 'Unsolicited inbound packets match no entry and are dropped. That is why you can\'t reach a laptop at home without port forwarding.', hot: { 'l1>rt': 'ok', l1: 'ok' }, label: { note: 'inbound without mapping → dropped' }, rows: [['inbound', 'needs mapping', 'warn']] },
            { note: 'Idle mappings expire. Long idle TCP connections through NAT die silently, so send keepalives.', hot: { note: 'warn' }, label: { note: 'UDP ~30 s, TCP ~2 h idle timeout' }, rows: [['fix', 'keepalives']] },
          ]
        : [
            { note: 'A service calls one database at 10.0.5.9:5432 through a cloud NAT gateway with one public IP.', hot: { rt: 'current' }, label: { l1: 'svc pods ×200', l2: 'batch jobs', srv: 'API 93.184.216.34' }, sub: { rt: '1 public IP' }, hide: ['note'], rows: [['ports per dst', '~64k']] },
            { note: 'Each connection to the same destination IP and port needs its own source port.', hot: { tbl: 'warn' }, sub: { tbl: '64,512 ports in use for 93.184.216.34:443' }, hide: ['note'], rows: [['ports used', '64,512', 'warn']] },
            { note: 'New connections fail with timeouts while old ones sit in TIME_WAIT. That is SNAT port exhaustion.', hot: { rt: 'fail', tbl: 'fail' }, label: { note: 'connect() timeouts under load' }, rows: [['symptom', 'intermittent connect failures', 'fail']] },
            { note: 'Fix with connection pooling and keep-alive, more NAT IPs, or private endpoints that skip NAT.', hot: { rt: 'ok', tbl: 'ok' }, label: { note: 'pool + keep-alive, add IPs' }, rows: [['fix', 'reuse connections', 'ok']] },
          ],
});

const v6Board: Board = {
  panel: 'IPv6',
  nodes: [
    N('addr', 40, 60, 920, 130, '2001:db8:85a3::8a2e:370:7334', '128 bits · 8 groups of 16', { detail: { title: 'IPv6 address', text: '128 bits in hex groups; :: replaces one run of zero groups. The first 64 bits are usually the network, the last 64 the interface.', code: '$ ip -6 addr show eth0\ninet6 2001:db8:85a3::8a2e:370:7334/64 scope global' } }),
    N('pre', 40, 250, 440, 120, '2001:db8:85a3::/48', 'site prefix'),
    N('sub', 520, 250, 440, 120, '/64 subnet', '2^64 hosts each'),
    N('ll', 40, 430, 440, 120, 'fe80::/10', 'link-local, always on'),
    N('slaac', 520, 430, 440, 120, 'SLAAC', 'hosts pick their own address'),
    N('nat', 40, 610, 920, 120, 'no NAT needed', 'every device globally addressable; firewall still required'),
    N('dual', 40, 790, 920, 120, 'dual stack', 'AAAA + A records, happy eyeballs races both'),
  ],
  edges: ['pre>sub'],
  beats: [
    { note: 'IPv6 addresses are 128 bits, written as 8 hex groups with :: for runs of zeros.', hot: { addr: 'current' }, hide: ['ll', 'slaac', 'nat', 'dual'], rows: [['address bits', 128]] },
    { note: 'A site typically gets a /48 and carves /64 subnets. A /64 is the standard LAN size.', hot: { pre: 'current', sub: 'current' }, hide: ['ll', 'slaac', 'nat', 'dual'], rows: [['/64 per subnet', '2^64 addrs']] },
    { note: 'Every interface also has a link-local fe80:: address, and hosts configure themselves with SLAAC from router adverts.', hot: { ll: 'current', slaac: 'current' }, hide: ['nat', 'dual'], rows: [['DHCP needed', 'optional']] },
    { note: 'There are enough addresses that NAT is unnecessary. Firewalls, not address scarcity, decide reachability.', hot: { nat: 'ok' }, hide: ['dual'], rows: [['NAT', 'none', 'ok']] },
    { note: 'Most networks run dual stack. Clients race IPv6 and IPv4 and use whichever connects first.', hot: { dual: 'current' }, rows: [['DNS', 'A + AAAA']] },
  ],
};

machineDemo({
  slug: 'nw-nat',
  title: 'NAT & IPv6',
  group: 'net-ip',
  summary: 'Source NAT and port mapping, the return path, SNAT port exhaustion, and how IPv6 removes the need for NAT.',
  inputs: [
    { id: 'snat', label: 'Outbound NAT', data: { k: 'snat' } },
    { id: 'return', label: 'Return path', data: { k: 'return' } },
    { id: 'exhaust', label: 'Port exhaustion', data: { k: 'exhaust' } },
    { id: 'ipv6', label: 'IPv6', data: { k: 'ipv6' } },
  ],
  build: ({ k }: { k: string }) => boardFrames(k === 'ipv6' ? v6Board : natBoard(k)),
});

