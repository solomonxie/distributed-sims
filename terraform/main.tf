# Depends on: variables.tf (all var.* below).
# Depended on by: outputs.tf; ansible-playbook (reads the inventory.ini
# written by local_file.ansible_inventory at the bottom).
#
# Everything for the one thing we currently provision — an EC2 host — lives
# here. Build order within the file:
#   provider
#     └─ data.aws_ami / data.aws_vpc / data.aws_subnets   (independent lookups)
#           └─ aws_security_group.web
#                 └─ aws_instance.app
#                       ├─ aws_eip.app
#                       └─ local_file.ansible_inventory   (bridge to ansible)

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_ami" "al2023_arm" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-kernel-*-arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "web" {
  name_prefix = "${var.project_name}-web-"
  description = "SSH from a fixed CIDR, HTTP/HTTPS from anywhere"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-web"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_instance" "app" {
  ami                         = data.aws_ami.al2023_arm.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.web.id]
  key_name                    = var.key_name
  associate_public_ip_address = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    delete_on_termination = true
  }

  tags = {
    Name = var.project_name
  }
}

# Stable public IP across stop/start so the generated ansible inventory
# doesn't go stale between runs.
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = var.project_name
  }
}

# Bridge to ansible: writes ../ansible/inventory.ini from the EIP.
resource "local_file" "ansible_inventory" {
  filename = "${path.module}/../ansible/inventory.ini"
  content = templatefile("${path.module}/templates/inventory.ini.tftpl", {
    host     = aws_eip.app.public_ip
    key_name = var.key_name
  })
}
