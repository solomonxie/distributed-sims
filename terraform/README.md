# Terraform

Provisions one ARM (Graviton, `t4g.micro`) EC2 instance in the account's
default VPC — 20GB gp3 root disk, a security group open on 22 (restricted)
/80/443, and a stable Elastic IP — to host the built React app behind
nginx. File order below is dependency order, not alphabetical; each file's
own header comment repeats its place in the graph.

```
terraform apply
  ├─ versions.tf       → terraform + aws/local provider version pins
  ├─ variables.tf      → resolve inputs (region, instance size, key pair, SSH CIDR)
  ├─ providers.tf      → configures the aws provider from var.aws_region
  ├─ data.tf           → looks up latest AL2023 arm64 AMI + default VPC/subnet
  ├─ security_group.tf → SG: 22 from ssh_allowed_cidr, 80/443 from anywhere
  ├─ ec2.tf            → the instance itself, off the AMI + SG + subnet above
  ├─ eip.tf            → stable public IP attached to the instance
  ├─ inventory.tf      → writes ../ansible/inventory.ini from the EIP
  └─ outputs.tf        → prints the public IP / SSH command
        │
        ▼
ansible-playbook -i ../ansible/inventory.ini ../ansible/playbook.yml
  (installs nginx, deploys the local `dist/` build as the web root)
```

## Usage

```
terraform init
terraform apply \
  -var="key_name=<your existing EC2 key pair name>" \
  -var="ssh_allowed_cidr=<your IP>/32"
```

`key_name` and `ssh_allowed_cidr` have no defaults on purpose — you must
consciously supply an existing key pair and a real CIDR, never
`0.0.0.0/0`, for SSH.

`terraform destroy` tears everything back down; this stack has no
auto-terminate timer (it's meant to be a standing host, not a throwaway
sandbox).
