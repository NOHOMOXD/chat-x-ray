#!/usr/bin/env python3
"""Aggregate twitch-xray session snapshots from testing_logs/ into JSON.

Reads every twitch-xray-session-*.json and twitch-xray-audit-*.json file and
emits a compact aggregate (never the raw text) used to build the audit report.
"""
import datetime
import json
import glob
import os
import re
import subprocess
import statistics
import sys
from collections import Counter, defaultdict

LOG_DIR = sys.argv[1] if len(sys.argv) > 1 else 'testing_logs'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'tools/audit-aggregate.json'

def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%H:%M:%S')


def norm(text):
    t = re.sub(r'[^0-9a-zа-яё]+', ' ', (text or '').lower())
    return ' '.join(t.split())


def load_sessions():
    out = []
    for path in sorted(glob.glob(os.path.join(LOG_DIR, 'twitch-xray-session-*.json'))):
        with open(path, encoding='utf-8') as fh:
            out.append((os.path.basename(path), json.load(fh)))
    return out


def load_audits():
    out = []
    for path in sorted(glob.glob(os.path.join(LOG_DIR, 'twitch-xray-audit-*.json'))):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        out.append((os.path.basename(path), data))
    return out


def viewer_series(samples):
    # A sampling gap longer than one minute starts a new series (docs/algorithm.md).
    samples = sorted(samples, key=lambda s: s['ts'])
    series, cur, gaps = [], [], []
    for s in samples:
        if cur and s['ts'] - cur[-1]['ts'] > 60000:
            gaps.append({'from': cur[-1]['ts'], 'to': s['ts'], 'ms': s['ts'] - cur[-1]['ts']})
            series.append(cur)
            cur = []
        cur.append(s)
    if cur:
        series.append(cur)
    return series, gaps


def epoch_ms(iso_time):
    return round(datetime.datetime.fromisoformat(iso_time.replace('Z', '+00:00')).timestamp() * 1000)


def chat_rate(msgs, a, b, coverage_start, coverage_end):
    start, end = max(a, coverage_start), min(b, coverage_end)
    covered = max(0, end - start)
    count = sum(start <= m['ts'] < end for m in msgs)
    return {
        'rate': round(count * 60000 / covered, 1) if covered else None,
        'coveredSeconds': round(covered / 1000, 1),
        'requestedSeconds': round((b - a) / 1000, 1),
        'complete': covered == b - a and covered > 0,
    }


def replay_movements(name, rate):
    tool = os.path.join(os.path.dirname(__file__), 'analyze-capture.mjs')
    report = json.loads(subprocess.check_output([
        'node', tool, '--snapshot', os.path.join(LOG_DIR, name), '--movements',
    ]))
    moves, churn = [], []
    for event in report['surges'] + report['outflows']:
        start = event['fromTs']
        end = event.get('peakTs') or event['lowTs']
        moves.append({
            **event, 'kind': 'surge' if event['delta'] > 0 else 'drop',
            'fromTime': iso(start), 'fromViewers': event['from'],
            'toTs': end, 'toTime': iso(end), 'toViewers': event['to'],
            'pct': round(100 * event['delta'] / event['from'], 1) if event['from'] else None,
            'minutes': round((end - start) / 60000, 2), 'peakValue': max(event['from'], event['to']),
            'chatRateBefore': rate(start - 120000, start), 'chatRateDuring': rate(start, end),
            'chatRateAfter': rate(end, end + 120000),
        })
        if event.get('recoveredAt'):
            recovered = event['recoveredAt']
            churn.append({
                **event, 'low': event['to'], 'drop': -event['delta'], 'fromTime': iso(start),
                'lowTime': iso(end), 'recoveredTime': iso(recovered),
                'durationS': (recovered - event['startedAt']) / 1000,
                'chatRateDuring': rate(start, recovered), 'chatRateAfter': rate(recovered, recovered + 120000),
            })
    return sorted(moves, key=lambda move: move['fromTs']), churn


def engine_events(sess, rate):
    """The app's own recorded anomalies, enriched with chat rates."""
    out = []
    for e in sess.get('events') or []:
        row = {'kind': e.get('kind'), 'reason': e.get('reason'),
               'time': iso(e['ts']), 'ts': e['ts']}
        if e.get('kind') == 'chat-wave':
            row.update(messages=e.get('messages'), authors=e.get('authors'))
        if e.get('kind') in ('surge', 'churn'):
            row.update({
                'from': e.get('from'), 'to': e.get('to'), 'delta': e.get('delta'),
                'fromTime': iso(e['fromTs']) if e.get('fromTs') else None,
                'durationS': round((e.get('durationMs') or 0) / 1000, 1),
                'beforeRate': e.get('beforeRate'), 'duringRate': e.get('duringRate'),
                'rateRatio': e.get('rateRatio'), 'raid': e.get('raid'),
            })
            ft = e.get('fromTs') or (e['ts'] - (e.get('durationMs') or 0))
            row['chatRateDerived'] = rate(ft, e['ts'])
            row['chatRateAfter'] = rate(e['ts'], e['ts'] + 120000)
        out.append(row)
    return out


def viewer_shape(samples, step_ms=30000):
    """Coarse 30-second view of the audience for the report tables."""
    if not samples:
        return []
    rows, buckets = [], {}
    for s in sorted(samples, key=lambda x: x['ts']):
        k = s['ts'] // step_ms
        b = buckets.setdefault(k, {'ts': k * step_ms, 'values': [], 'clean': []})
        b['values'].append(s['value'])
        b['clean'].append(s.get('clean') or 0)
    for k in sorted(buckets):
        b = buckets[k]
        rows.append({'time': iso(b['ts']), 'value': max(b['values']),
                     'clean': max(b['clean'])})
    return rows


def summarize(name, sess):
    ch = sess['channel']
    cur = sess['current']
    stats = cur['stats'] or {}
    model = cur['model'] or {}
    msgs = sorted(cur.get('messages') or [], key=lambda m: m['ts'])
    started_at = epoch_ms(sess['startedAt'])
    exported_at = epoch_ms(sess['exportedAt'])
    coverage_ms = min(exported_at - started_at, cur.get('durationMs') or 0)

    def rate(start, end):
        return chat_rate(msgs, start, end, exported_at - coverage_ms, exported_at)

    wave_events = [e for e in sess.get('events') or [] if e['kind'] == 'chat-wave']
    wave_buckets = defaultdict(list)
    for message in msgs:
        if message.get('waveBoost'):
            wave_buckets[message['bucketStart']].append(message)
    last_model = sess.get('lastViewerModel') or model or next(
        (minute['model'] for minute in reversed(sess.get('minutes') or []) if minute.get('model')),
        None,
    )
    samples = sess.get('viewerSamples') or []
    series, gaps = viewer_series(samples)
    moves, churn = replay_movements(name, rate)
    values = [s['value'] for s in samples]

    # ---- authors
    authors = defaultdict(lambda: {'userKey': None, 'login': None, 'n': 0, 'scores': [],
                                   'r9k': 0, 'flood': 0, 'texts': [], 'first': None, 'last': None,
                                   'age': None, 'exempt': False, 'service': False,
                                   'triggers': Counter(), 'peers': 0, 'wave': 0, 'live': 0})
    for m in msgs:
        k = m.get('userKey') or f"id:{m.get('userId')}"
        a = authors[k]
        a['userKey'] = k
        a['login'] = a['login'] or (m.get('displayName') or '')
        a['n'] += 1
        a['scores'].append(m.get('botScore') or 0)
        a['r9k'] += 1 if m.get('isR9KDuplicate') else 0
        a['flood'] += 1 if m.get('spamFlood') else 0
        a['wave'] += 1 if m.get('waveBoost') else 0
        a['exempt'] = a['exempt'] or bool(m.get('roleExempt'))
        a['service'] = a['service'] or bool(m.get('serviceBot'))
        a['peers'] = max(a['peers'], m.get('clusterPeers') or 0)
        if m.get('accountAgeDays') is not None:
            a['age'] = m.get('accountAgeDays')
        for t in m.get('triggers') or []:
            a['triggers'][t['key']] += 1
        a['first'] = m['ts'] if a['first'] is None else min(a['first'], m['ts'])
        a['last'] = m['ts'] if a['last'] is None else max(a['last'], m['ts'])
        if len(a['texts']) < 400:
            a['texts'].append((m['ts'], m.get('text') or ''))

    # ---- filter comparison
    thr = settings_threshold(sess)
    r9k_on = settings_value(sess, 'clientR9K')
    score_on = settings_value(sess, 'muteSuspicious') or settings_value(sess, 'hideSuspicious')
    rej_r9k = [m for m in msgs if m.get('isR9KDuplicate') or m.get('spamFlood')]
    rej_score = [m for m in msgs if m.get('suspicious', (m.get('botScore') or 0) >= thr)]
    both = [m for m in msgs if m in rej_r9k and m in rej_score]
    union = [m for m in msgs if m in rej_r9k or m in rej_score]

    # Legacy captures store the applied age adjustment as a negative trigger.
    def score_before_discount(message):
        adjustment = sum(t['points'] for t in message.get('triggers') or []
                         if t['key'] == 'veteran-account')
        return min(100, message['botScore'] - adjustment)

    discounts = [m for m in msgs if score_before_discount(m) > m['botScore']]
    crossing = [m for m in discounts if m['botScore'] < thr <= score_before_discount(m)]
    waived_alive = [m for m in crossing if not (m.get('isR9KDuplicate') or m.get('spamFlood'))]

    score_dist = Counter((m.get('botScore') or 0) for m in msgs)
    buckets = {'0': 0, '1-9': 0, '10-24': 0, '25-29': 0, '30-49': 0, '50-100': 0}
    for s, c in score_dist.items():
        if s == 0: buckets['0'] += c
        elif s < 10: buckets['1-9'] += c
        elif s < 25: buckets['10-24'] += c
        elif s < 30: buckets['25-29'] += c
        elif s < 50: buckets['30-49'] += c
        else: buckets['50-100'] += c

    # ---- suspicious author ranking
    ranked = []
    for k, a in authors.items():
        if a['service']:
            continue
        low = [t for t in a['texts'] if len(norm(t[1])) > 0]
        keys = [template_key(t[1]) for t in low]
        uniq = len(set(keys))
        repetition = 1 - (uniq / len(low)) if low else 0
        top_template = max(Counter(k for k in keys if len(k) >= 12).items(),
                           key=lambda kv: kv[1], default=(None, 0))
        ranked.append({
            'login': a['login'], 'userKey': k, 'messages': a['n'],
            'maxScore': max(a['scores']) if a['scores'] else 0,
            'avgScore': round(sum(a['scores']) / len(a['scores']), 1) if a['scores'] else 0,
            'r9k': a['r9k'], 'flood': a['flood'], 'wave': a['wave'],
            'exempt': a['exempt'], 'age': a['age'], 'peers': a['peers'],
            'uniqueTexts': uniq, 'repetition': round(repetition, 2),
            'topTemplate': top_template[0][:60] if top_template[0] else None,
            'topTemplateCount': top_template[1],
            'spanS': round(((a['last'] or 0) - (a['first'] or 0)) / 1000, 1),
            'triggers': dict(a['triggers']),
            'samples': [t[1][:60] for t in low[:3]],
        })
    ranked.sort(key=lambda x: (x['maxScore'], x['r9k'] + x['flood'], x['messages']), reverse=True)

    return {
        'file': name, 'channel': ch, 'sessionId': sess.get('id'),
        'startedAt': sess.get('startedAt'), 'exportedAt': sess.get('exportedAt'),
        'durationMs': cur.get('durationMs'), 'observedMinutes': stats.get('observedMinutes'),
        'sessionDurationMs': exported_at - started_at,
        'chatCoverageMs': coverage_ms,
        'chatWindowMs': 600000,
        'lastViewerModelAt': last_model.get('sampledAt') if last_model else None,
        'waves': {
            'sessionCount': (stats.get('waveCount') if len(wave_events) == stats.get('waveCount')
                             else None),
            'recordedEvents': wave_events,
            'observedBuckets': [
                {'bucketStart': start, 'messages': len(records),
                 'authors': len({record['userKey'] for record in records})}
                for start, records in sorted(wave_buckets.items())
            ],
        },
        'settings': (sess.get('settings') or [{}])[0].get('value'),
        'viewer': {
            'samples': len(values),
            'min': min(values) if values else None, 'max': max(values) if values else None,
            'median': statistics.median(values) if values else None,
            'first': values[0] if values else None, 'last': values[-1] if values else None,
            'series': len(series), 'gaps': gaps,
        },
        'messages': len(msgs),
        'authors': stats.get('activeUsers'),
        'cleanAuthors': stats.get('cleanUsers'),
        'suspiciousAuthors': stats.get('suspiciousUsers'),
        'freshUsers': stats.get('freshUsers'),
        'serviceBots': stats.get('serviceBots'),
        'sessionUsers': stats.get('sessionUsers'),
        'mpp': stats.get('messagesPerMinute'),
        'model': {'verdict': (model.get('verdict') or {}), 'official': model.get('official'),
                  'range': model.get('range')},
        'events': sess.get('events') or [],
        'moves': moves,
        'churn': churn,
        'engineEvents': engine_events(sess, rate),
        'viewer30s': viewer_shape(samples),
        'minuteSummary': minute_rows(sess),
        'filter': {
            'threshold': thr, 'r9kEnabled': r9k_on, 'scoreActionEnabled': score_on,
            'total': len(msgs),
            'r9kRejected': len(rej_r9k), 'scoreRejected': len(rej_score),
            'both': len(both), 'union': len(union),
            'r9kPct': round(len(rej_r9k) / len(msgs) * 100, 1) if msgs else 0,
            'scorePct': round(len(rej_score) / len(msgs) * 100, 1) if msgs else 0,
            'unionPct': round(len(union) / len(msgs) * 100, 1) if msgs else 0,
            'overlapPctOfUnion': round(len(both) / len(union) * 100, 1) if union else 0,
            'scoreDist': dict(sorted(score_dist.items())),
            'scoreBuckets': buckets,
            'discountedMessages': len(discounts),
            'discountedAuthors': len({m.get('userKey') for m in discounts}),
            'discountCrossingMessages': len(crossing),
            'discountCrossingAlive': len(waived_alive),
            'crossingExamples': [
                {'login': m.get('displayName'), 'score': m.get('botScore'),
                 'raw': score_before_discount(m), 'r9k': bool(m.get('isR9KDuplicate')),
                 'text': (m.get('text') or '')[:50]} for m in crossing[:6]],
            'triggerTotals': dict(Counter(t['key'] for m in msgs for t in (m.get('triggers') or [])).most_common()),
            'diagnostics': cur.get('diagnostics'),
        },
        'deadFlags': {
            'solicitation': sum(1 for m in msgs if m.get('solicitation')),
            'selfRepeat': sum(1 for m in msgs if any(t['key'] == 'self-repeat' for t in (m.get('triggers') or []))),
            'idCluster': sum(1 for m in msgs if any(t['key'] == 'id-cluster' for t in (m.get('triggers') or []))),
            'serverTimestampTrue': sum(1 for m in msgs if m.get('serverTimestamp')),
            'domBoundFalse': sum(1 for m in msgs if m.get('_domBound') is False),
            'pendingKeysNonEmpty': sum(1 for m in msgs if m.get('_pendingKeys')),
        },
        'ranked': ranked[:40],
        'allAuthors': {k: {'login': a['login'], 'scores': max(a['scores']) if a['scores'] else 0} for k, a in authors.items()},
        '_texts': [(k, a['login'], a['texts']) for k, a in authors.items()],
    }


def settings_value(sess, key):
    st = (sess.get('settings') or [{}])[0].get('value') or {}
    return st.get(key)


def settings_threshold(sess):
    return settings_value(sess, 'suspiciousThreshold') or 30


def minute_rows(sess):
    rows = []
    for m in sess.get('minutes') or []:
        st = m.get('stats') or {}
        md = m.get('model') or {}
        if md:
            churn = md.get('churn') or {}
            rows.append({
                'ts': m['ts'], 'time': iso(m['ts']),
                'official': md.get('official'),
                'mpp': st.get('messagesPerMinute'), 'clean': st.get('cleanUsers'),
                'active': st.get('activeUsers'), 'suspPct': st.get('suspiciousPercent'),
                'er': (md.get('range') or {}).get('midpoint'),
                'verdict': (md.get('verdict') or {}).get('key'),
                'churnEvents': churn.get('churnEvents'), 'surges': churn.get('totalSurges'),
            })
    return rows


STREAMER_TOKENS = re.compile(
    r'\b(case|caseoh|casey|kai|kaicenat|miya|speed|ishowspeed|ronaldo|stableronaldo|'
    r'mel|melharucos|tabula|fed|fedy|fedokbak|ded|dedbaldesh|bigrussianmum|brm|'
    r'welovegames|lovegames|peanut|darren)\b')


def template_key(text):
    t = re.sub(r'[^0-9a-zа-яё]+', ' ', (text or '').lower())
    t = STREAMER_TOKENS.sub(' ', t)
    return ' '.join(t.split())


def is_emote_spam(key):
    """'dinodance dinodance dinodance' is one emote repeated, not a script."""
    words = key.split()
    return len(words) >= 2 and len(set(words)) == 1


def cross_channel_sync(sessions):
    """Same normalised template (streamer name masked) from different accounts.
    Two families are separated: repeated-emote floods and real scripted text."""
    hits = defaultdict(list)
    for s in sessions:
        for k, login, texts in s['_texts']:
            seen = set()
            for ts, t in texts:
                key = template_key(t)
                if len(key) < 12 or (k, key) in seen:
                    continue
                seen.add((k, key))
                hits[key].append((s['channel'], k, ts, t, s['channel']))
    out = []
    for key, rows in hits.items():
        authors = {r[1] for r in rows}
        if len(authors) < 3:
            continue
        rows.sort(key=lambda r: r[2])
        clusters = []
        for r in rows:
            placed = False
            for c in clusters:
                if r[2] - c[-1][2] <= 30000 and r[1] not in {x[1] for x in c}:
                    c.append(r)
                    placed = True
                    break
            if not placed:
                clusters.append([r])
        best = max(clusters, key=lambda c: len({x[1] for x in c}))
        if len({x[1] for x in best}) < 3:
            continue
        out.append({
            'text': best[0][3][:80], 'normalized': key[:80],
            'emoteOnly': is_emote_spam(key),
            'authors': len({x[1] for x in best}),
            'channels': sorted({x[0] for x in best}),
            'spanS': round((best[-1][2] - best[0][2]) / 1000, 1),
            'time': iso(best[0][2]),
            'ids': [x[1] for x in best][:10],
        })
    out.sort(key=lambda x: (not x['emoteOnly'], x['authors'], x['spanS']), reverse=True)
    return out[:20]
def band_of(uid):
    return bool(uid) and 1610000000 <= uid <= 1612000000


def author_rank(sessions):
    """Cross-session author table with a composite 'suspicion' score."""
    rows = {}
    for s in sessions:
        for a in s['ranked']:
            key = a['userKey']
            r = rows.setdefault(key, {
                'userKey': key, 'channels': [], 'messages': 0, 'maxScore': 0,
                'r9k': 0, 'flood': 0, 'wave': 0, 'peers': 0, 'age': None,
                'repetition': 0.0, 'topTemplate': None, 'topTemplateCount': 0,
                'samples': [], 'triggers': Counter(), 'exempt': a['exempt'],
            })
            r['channels'].append(s['channel'])
            r['messages'] += a['messages']
            r['maxScore'] = max(r['maxScore'], a['maxScore'])
            r['r9k'] += a['r9k']
            r['flood'] += a['flood']
            r['wave'] += a['wave']
            r['peers'] = max(r['peers'], a['peers'])
            r['age'] = a['age'] if a['age'] is not None else r['age']
            r['repetition'] = max(r['repetition'], a['repetition'])
            if a['topTemplateCount'] > r['topTemplateCount']:
                r['topTemplate'] = a['topTemplate']
                r['topTemplateCount'] = a['topTemplateCount']
            r['samples'] += a['samples']
            r['triggers'].update(a['triggers'])
            r['exempt'] = r['exempt'] and a['exempt']
    out = []
    for r in rows.values():
        if r['exempt']:
            continue        # moderators / streamer / service bots always score 0
        uid = int(r['userKey'].split(':')[1]) if r['userKey'].startswith('id:') else 0
        r['bandId'] = band_of(uid)
        # composite: profile score dominates, volume and repetition add
        comp = (r['maxScore'] * 1.0 + min(r['messages'], 10) * 2.0
                + min(r['r9k'] + r['flood'], 6) * 3.0
                + (12 if r['bandId'] else 0)
                + min(r['peers'], 30) * 0.4
                + r['repetition'] * 10
                + (5 if len(set(r['channels'])) > 1 else 0))
        r['suspicion'] = round(comp, 1)
        r['triggers'] = dict(r['triggers'])
        r['samples'] = r['samples'][:3]
        r['channels'] = sorted(set(r['channels']))
        out.append(r)
    out.sort(key=lambda r: r['suspicion'], reverse=True)
    return out[:25]


def burst_analysis(sessions):
    """30-second buckets where suspicious (score>=threshold) messages dominate."""
    out = []
    for s in sessions:
        thr = s['filter']['threshold']
        out.append(s['filter']['total'])
    return out


def filter_leaks():
    """Messages that repeat a template yet reach the audience: same author
    re-posting identical text without an R9K flag and below the score line."""
    from collections import defaultdict
    leaks = defaultdict(list)
    for path in sorted(glob.glob(os.path.join(LOG_DIR, 'twitch-xray-session-*.json'))):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        thr = settings_threshold(data)
        for m in data['current']['messages']:
            key = template_key(m.get('text'))
            if len(key) < 15:
                continue
            if m.get('isR9KDuplicate') or m.get('spamFlood'):
                continue
            if m.get('suspicious', (m.get('botScore') or 0) >= thr):
                continue
            leaks[(data['channel'], m.get('userKey'), key)].append(m['ts'])
    rows = []
    for (ch, uk, key), ts in leaks.items():
        if len(ts) >= 2:
            rows.append({'channel': ch, 'userKey': uk, 'template': key[:70],
                         'repeats': len(ts), 'times': [iso(t) for t in sorted(ts)],
                         'gapsS': [round((b - a) / 1000) for a, b in zip(sorted(ts), sorted(ts)[1:])]})
    rows.sort(key=lambda r: r['repeats'], reverse=True)
    return rows[:20]


def main():
    sessions = []
    for name, data in load_sessions():
        sessions.append(summarize(name, data))
    audits = []
    for name, data in load_audits():
        audits.append({'file': name, 'channel': data[0]['channel'] if data else None,
                       'messages': len(data),
                       'firstTs': min((m['timestamp'] for m in data), default=None),
                       'lastTs': max((m['timestamp'] for m in data), default=None),
                       'topTriggers': dict(Counter(k for m in data for k in m.get('triggerKeys') or []).most_common(8))})
    sync = cross_channel_sync(sessions)
    for s in sessions:
        s.pop('_texts', None)
    ranking = author_rank(sessions)
    leaks = filter_leaks()
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump({'sessions': sessions, 'audits': audits, 'sync': sync,
                   'ranking': ranking, 'leaks': leaks}, fh, ensure_ascii=False, indent=1)
    print('wrote', OUT, 'sessions', len(sessions), 'audits', len(audits), 'sync clusters', len(sync))


if __name__ == '__main__':
    main()
