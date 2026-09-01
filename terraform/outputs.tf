# Depends on: eip.tf (aws_eip.app), ec2.tf (aws_instance.app).
# Depended on by: nothing — terminal node, printed for the operator.

output "public_ip" {
  value = aws_eip.app.public_ip
}

output "ssh_command" {
  value = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.app.public_ip}"
}
