# Depends on: versions.tf (aws provider must be declared), variables.tf
# (var.aws_region).
# Depended on by: every resource/data source below (implicit default
# provider).

provider "aws" {
  region = var.aws_region
}
