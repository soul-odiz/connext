import sqlite3, os, sys

paths = [
    r'c:\Users\maoro\Desktop\connextAttempt\instance\dating_app.db',
    r'c:\Users\maoro\Desktop\connextAttempt\src\instance\dating_app.db',
]

for p in paths:
    print(f'\n--- {p} ---')
    if not os.path.exists(p):
        print('  NOT FOUND')
        continue
    print(f'  Size: {os.path.getsize(p)} bytes')
    conn = sqlite3.connect(p)
    cur = conn.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f'  Tables: {tables}')
    if 'user' in tables:
        rows = cur.execute('SELECT id, username, gender, preferred_gender FROM "user"').fetchall()
        print(f'  Users ({len(rows)}):')
        for r in rows:
            print(f'    {r}')
    if 'match_session' in tables:
        rows = cur.execute('SELECT id, user1_id, user2_id, status, created_at FROM match_session').fetchall()
        print(f'  match_session ({len(rows)}):')
        for r in rows:
            print(f'    {r}')
    if 'message' in tables:
        rows = cur.execute('SELECT id, sender_id, receiver_id, text FROM message').fetchall()
        print(f'  messages ({len(rows)}):')
        for r in rows:
            print(f'    {r}')
    conn.close()

sys.stdout.flush()
