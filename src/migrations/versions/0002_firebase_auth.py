"""Add Firebase auth columns to user model

Revision ID: 0002_firebase_auth
Revises: 0001_complete_schema
Create Date: 2026-08-11

Adds email, auth_provider, email_verified and firebase_uid columns to support
Google / Apple / email-password sign up via Firebase Authentication.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0002_firebase_auth'
down_revision = '0001_complete_schema'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('email', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column(
            'auth_provider', sa.String(length=20),
            nullable=False, server_default='local'
        ))
        batch_op.add_column(sa.Column(
            'email_verified', sa.Boolean(),
            nullable=False, server_default='false'
        ))
        batch_op.add_column(sa.Column('firebase_uid', sa.String(length=128), nullable=True))
        # Social (Google/Apple) users have no password set
        batch_op.alter_column('password_hash', existing_type=sa.String(length=255), nullable=True)

    # Create indexes (PostgreSQL supports CREATE INDEX IF NOT EXISTS)
    op.execute('CREATE INDEX IF NOT EXISTS ix_user_email ON "user" (email)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_user_firebase_uid ON "user" (firebase_uid)')


def downgrade():
    op.execute('DROP INDEX IF EXISTS ix_user_firebase_uid')
    op.execute('DROP INDEX IF EXISTS ix_user_email')
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('firebase_uid')
        batch_op.drop_column('email_verified')
        batch_op.drop_column('auth_provider')
        batch_op.drop_column('email')