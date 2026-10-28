import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1
    def handle_data(self, text):
        if not self.hidden:
            self.parts.append(text)

def parse(html):
    p = PageText()
    p.feed(html)
    text = ' '.join(' '.join(p.parts).split())
    pattern = r'코스피200 야간선물\s+장 마감\s+([\d,]+\.\d{2}).{0,160}?계약\s+([A-Z0-9]+).{0,120}?마지막 시세\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})'
    matches = re.findall(pattern, text)
    if len(matches) != 1:
        return None
    price, contract, date, clock = matches[0]
    return {'value': float(price.replace(',', '')), 'contract': contract, 'date': date, 'clock': clock}

if __name__ == '__main__':
    try:
        allowed = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'LANG') if key in os.environ}
        result = subprocess.run(['google-chrome', '--headless', '--no-sandbox', '--disable-gpu',
            '--disable-dev-shm-usage', '--virtual-time-budget=25000', '--dump-dom',
            'https://nfutures.tradingforaliving.co.kr/'], capture_output=True, text=True,
            env=allowed, timeout=40, check=True)
        if len(result.stdout) > 4000000:
            raise ValueError('page size')
        print(json.dumps(parse(result.stdout)))
    except Exception:
        print('null')
