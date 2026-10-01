import smtplib
from email.message import EmailMessage

# Your Gmail address
sender_email = "bhandaresandesh26@gmail.com"

# Gmail App Password (NOT your normal Gmail password)
app_password = "llor tlgk nbbx kich"

# Recipients
recipients = [
    "sandeshbhandare226@gmail.com",
    "2317053@ritindia.edu",
    "2317056@ritindia.edu"]

# Create email
msg = EmailMessage()
msg["Subject"] = "Important Notice"
msg["From"] = sender_email

# Put your own email in To
# Recipients won't see each other
msg["To"] = sender_email

msg.set_content("""
Hello Everyone,

This is a test message

Regards,
RRPS4E Innovation.
""")

# Send email
with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
    server.login(sender_email, app_password)

    server.send_message(
        msg,
        from_addr=sender_email,
        to_addrs=recipients
    )

print("Email sent successfully!")
