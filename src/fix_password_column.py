"""One-time fix: enlarge password_hash column from VARCHAR(120) to VARCHAR(255)."""
from app import app, db
from sqlalchemy import text

with app.app_context():
    db.session.execute(text('ALTER TABLE "user" ALTER COLUMN password_hash TYPE VARCHAR(255)'))
    db.session.commit()
    print('Column password_hash altered to VARCHAR(255)')