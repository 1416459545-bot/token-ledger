import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  explicitPeriod,
  isValidDay,
  lastDaysPeriod,
  monthPeriod,
  parseLastDays,
} from '../src/core/period.ts';

test('整月区间：起止日期正确，且标记为完整月', () => {
  const feb = monthPeriod('2026-02');
  assert.equal(feb.start, '2026-02-01');
  assert.equal(feb.end, '2026-02-28');
  assert.equal(feb.month, '2026-02');
  assert.equal(feb.label, '2026-02');

  const leap = monthPeriod('2028-02');
  assert.equal(leap.end, '2028-02-29');
});

test('最近 N 天含今天', () => {
  const now = new Date(2026, 10, 18, 15, 30, 0); // 2026-11-18 本地
  const week = lastDaysPeriod(7, now);
  assert.equal(week.end, '2026-11-18');
  assert.equal(week.start, '2026-11-12'); // 18,17,16,15,14,13,12 共 7 天
  assert.match(week.label, /最近 7 天/);
  assert.equal(week.month, null);

  const oneDay = lastDaysPeriod(1, now);
  assert.equal(oneDay.start, oneDay.end);
});

test('最近 N 天跨月也正确', () => {
  const now = new Date(2026, 10, 3, 9, 0, 0); // 2026-11-03
  const period = lastDaysPeriod(10, now);
  assert.equal(period.start, '2026-10-25');
  assert.equal(period.end, '2026-11-03');
});

test('显式区间：只给 since 则到今天，只给 until 则只统计那天', () => {
  const now = new Date(2026, 10, 18, 10, 0, 0);

  const open = explicitPeriod('2026-11-01', null, now);
  assert.ok(open);
  assert.equal(open.end, '2026-11-18');
  assert.equal(open.label, '2026-11-01 ~ 2026-11-18');

  const single = explicitPeriod(null, '2026-11-05', now);
  assert.ok(single);
  assert.equal(single.start, '2026-11-05');
  assert.equal(single.label, '2026-11-05');
});

test('恰好覆盖整个自然月时才带上 month（决定是否显示预算）', () => {
  const whole = explicitPeriod('2026-11-01', '2026-11-30');
  assert.ok(whole);
  assert.equal(whole.month, '2026-11');

  const partial = explicitPeriod('2026-11-01', '2026-11-15');
  assert.ok(partial);
  assert.equal(partial.month, null);

  const crossMonth = explicitPeriod('2026-10-15', '2026-11-15');
  assert.ok(crossMonth);
  assert.equal(crossMonth.month, null);
});

test('非法输入返回 null', () => {
  assert.equal(explicitPeriod(null, null), null);
  assert.equal(explicitPeriod('2026-13-01', null), null);
  assert.equal(explicitPeriod('not-a-date', null), null);
  assert.equal(explicitPeriod('2026-11-15', '2026-11-01'), null); // since > until
});

test('isValidDay 校验真实存在的日期', () => {
  assert.equal(isValidDay('2026-11-18'), true);
  assert.equal(isValidDay('2026-02-29'), false); // 2026 不是闰年
  assert.equal(isValidDay('2028-02-29'), true);
  assert.equal(isValidDay('2026-1-1'), false);
});

test('parseLastDays 只接受 Nd', () => {
  assert.equal(parseLastDays('7d'), 7);
  assert.equal(parseLastDays(' 30D '), 30);
  assert.equal(parseLastDays('7'), null);
  assert.equal(parseLastDays('0d'), null);
  assert.equal(parseLastDays('-3d'), null);
  assert.equal(parseLastDays('9999d'), null);
});
