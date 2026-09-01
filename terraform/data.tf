# Depends on: providers.tf (aws provider).
# Depended on by: ec2.tf (AMI, subnet), security_group.tf (VPC).
#
# data.aws_ami.al2023_arm  -> latest Amazon Linux 2023 arm64 image
# data.aws_vpc.default     -> the account's default VPC
# data.aws_subnets.default -> its subnets (fan-out from the VPC lookup)

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
