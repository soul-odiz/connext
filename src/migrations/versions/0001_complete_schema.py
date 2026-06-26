"""Complete schema migration - all tables and columns

Revision ID: 0001_complete_schema
Revises: f3edbf05046c
Create Date: 2026-06-26

This migration brings a fresh PostgreSQL database to the full current schema.
It is safe to run on an existing database - all operations use IF NOT EXISTS
or check for column existence before altering.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision = '0001_complete_schema'
down_revision = 'f3edbf05046c'
branch_labels = None
depends_on = None


def _column_exists(table, column):
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    columns = [c['name'] for c in inspector.get_columns(table)]
    return column in columns


def _table_exists(table):
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return table in inspector.get_table_names()


def upgrade():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    # ── user table ──────────────────────────────────────────────────────
    if not _table_exists('user'):
        op.create_table(
            'user',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('username', sa.String(80), nullable=False),
            sa.Column('password_hash', sa.String(120), nullable=False),
            sa.Column('age', sa.Integer(), nullable=True),
            sa.Column('gender', sa.String(10), nullable=True),
            sa.Column('bio', sa.String(500), nullable=True),
            sa.Column('interests', sa.Text(), nullable=True),
            sa.Column('profile_image', sa.String(100), nullable=True),
            sa.Column('preferred_age_min', sa.Integer(), nullable=True),
            sa.Column('preferred_age_max', sa.Integer(), nullable=True),
            sa.Column('preferred_gender', sa.String(10), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('latitude', sa.Float(), nullable=True),
            sa.Column('longitude', sa.Float(), nullable=True),
            sa.Column('phone_number', sa.String(15), nullable=True),
            sa.Column('is_in_queue', sa.Boolean(), nullable=True, server_default='false'),
            sa.Column('current_session_id', sa.String(50), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('last_active', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('username'),
        )
        op.create_index('ix_user_username', 'user', ['username'])
        op.create_index('ix_user_gender', 'user', ['gender'])
        op.create_index('ix_user_preferred_gender', 'user', ['preferred_gender'])
        op.create_index('ix_user_is_in_queue', 'user', ['is_in_queue'])
        op.create_index('idx_user_gender_age', 'user', ['gender', 'age'])
        op.create_index('idx_user_pref_gender_age', 'user', ['preferred_gender', 'preferred_age_min', 'preferred_age_max'])
    else:
        # Table exists — add any missing columns
        user_cols = [c['name'] for c in inspector.get_columns('user')]

        if 'interests' in user_cols:
            # Migrate interests from String(200) to Text if needed
            op.alter_column('user', 'interests', type_=sa.Text(), existing_nullable=True)

        for col_name, col_def in [
            ('city', sa.String(100)),
            ('latitude', sa.Float()),
            ('longitude', sa.Float()),
            ('phone_number', sa.String(15)),
            ('is_in_queue', sa.Boolean()),
            ('current_session_id', sa.String(50)),
            ('created_at', sa.DateTime()),
            ('last_active', sa.DateTime()),
            ('preferred_age_min', sa.Integer()),
            ('preferred_age_max', sa.Integer()),
        ]:
            if col_name not in user_cols:
                op.add_column('user', sa.Column(col_name, col_def, nullable=True))

        # Create indexes if missing
        existing_indexes = {i['name'] for i in inspector.get_indexes('user')}
        if 'idx_user_gender_age' not in existing_indexes:
            op.create_index('idx_user_gender_age', 'user', ['gender', 'age'])
        if 'idx_user_pref_gender_age' not in existing_indexes:
            op.create_index('idx_user_pref_gender_age', 'user', ['preferred_gender', 'preferred_age_min', 'preferred_age_max'])

    # ── match_session table ──────────────────────────────────────────────
    if not _table_exists('match_session'):
        op.create_table(
            'match_session',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('session_id', sa.String(50), nullable=False),
            sa.Column('user1_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('user2_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('status', sa.String(20), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('audio_turn', sa.Integer(), nullable=True),
            sa.Column('audio_turn_start', sa.DateTime(), nullable=True),
            sa.Column('stage_started_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('session_id'),
        )
        op.create_index('ix_match_session_session_id', 'match_session', ['session_id'])
        op.create_index('ix_match_session_user1_id', 'match_session', ['user1_id'])
        op.create_index('ix_match_session_user2_id', 'match_session', ['user2_id'])
        op.create_index('ix_match_session_status', 'match_session', ['status'])
        op.create_index('idx_match_session_users_status', 'match_session', ['user1_id', 'user2_id', 'status'])
    else:
        ms_cols = [c['name'] for c in inspector.get_columns('match_session')]
        for col_name, col_def in [
            ('audio_turn', sa.Integer()),
            ('audio_turn_start', sa.DateTime()),
            ('stage_started_at', sa.DateTime()),
        ]:
            if col_name not in ms_cols:
                op.add_column('match_session', sa.Column(col_name, col_def, nullable=True))

        existing_indexes = {i['name'] for i in inspector.get_indexes('match_session')}
        if 'idx_match_session_users_status' not in existing_indexes:
            op.create_index('idx_match_session_users_status', 'match_session', ['user1_id', 'user2_id', 'status'])

    # ── phone_call_session table ─────────────────────────────────────────
    if not _table_exists('phone_call_session'):
        op.create_table(
            'phone_call_session',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('caller_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('receiver_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('status', sa.String(20), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_phone_call_session_status', 'phone_call_session', ['status'])

    # ── date_details table ───────────────────────────────────────────────
    if not _table_exists('date_details'):
        op.create_table(
            'date_details',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user1_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('user2_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('date_time', sa.DateTime(), nullable=True),
            sa.Column('location', sa.String(100), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )

    # ── message table ────────────────────────────────────────────────────
    if not _table_exists('message'):
        op.create_table(
            'message',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('sender_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('receiver_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('text', sa.String(500), nullable=True),
            sa.Column('timestamp', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_message_sender_id', 'message', ['sender_id'])
        op.create_index('ix_message_receiver_id', 'message', ['receiver_id'])
        op.create_index('ix_message_timestamp', 'message', ['timestamp'])
        op.create_index('idx_message_conversation', 'message', ['sender_id', 'receiver_id', 'timestamp'])
    else:
        existing_indexes = {i['name'] for i in inspector.get_indexes('message')}
        if 'idx_message_conversation' not in existing_indexes:
            op.create_index('idx_message_conversation', 'message', ['sender_id', 'receiver_id', 'timestamp'])

    # ── match_queue table ────────────────────────────────────────────────
    if not _table_exists('match_queue'):
        op.create_table(
            'match_queue',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=True),
            sa.Column('timestamp', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id'),
        )
        op.create_index('ix_match_queue_user_id', 'match_queue', ['user_id'])
        op.create_index('ix_match_queue_timestamp', 'match_queue', ['timestamp'])


def downgrade():
    # Drop in reverse dependency order
    op.drop_table('match_queue')
    op.drop_table('message')
    op.drop_table('date_details')
    op.drop_table('phone_call_session')
    op.drop_table('match_session')
    op.drop_table('user')
