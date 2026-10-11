/**
 * iMATOMs sMART pLAN V1.0 — Google Apps Script backend
 * ------------------------------------------------------
 * หน้าที่:
 *   1) รับรายการงานที่มีกำหนดเวลา (Schedule Work / Daily Plan / Inspection / DMAIC) จากเว็บแอป
 *   2) ตรวจทุก 15 นาที แล้วส่งอีเมลแจ้งเตือนเมื่อใกล้ถึงกำหนด / ถึงกำหนดแล้ว
 *   3) ส่งสรุปงานประจำวันทุกเช้า 07:00 น.
 *   4) รับไฟล์ Backup (.json) แล้วเก็บลง Google Drive
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. Login Google ด้วย imatomsapps1976@gmail.com → เปิด https://script.google.com → New project
 *   2. ลบโค้ดเดิม วางโค้ดไฟล์นี้ทั้งหมด → Save (ตั้งชื่อ "iMATOMs sMART pLAN")
 *   3. เลือกฟังก์ชัน setup ในแถบด้านบน → กด Run → Authorize (Advanced → Go to ... → Allow)
 *      ระบบจะสร้าง Google Sheet เก็บข้อมูล + ตั้ง Trigger + ส่งอีเมลทดสอบ 1 ฉบับ
 *   4. Deploy → New deployment → ⚙️ Web app → Execute as: Me, Who has access: Anyone → Deploy
 *   5. คัดลอก Web app URL (ลงท้าย /exec) ไปวางในเว็บ: Schedule Work → ⚙️ ตั้งค่าแจ้งเตือน
 *
 * หมายเหตุ: ถ้าแก้โค้ดภายหลัง ต้อง Deploy → Manage deployments → Edit → Version: New version
 */

var CONFIG = {
  NOTIFY_EMAIL: 'imatomsapps1976@gmail.com',   // อีเมลรับแจ้งเตือน (เว็บแอปส่งค่ามาแทนได้)
  TIMEZONE: 'Asia/Bangkok',
  APP_NAME: 'iMATOMs sMART pLAN V1.0',
  APP_URL: 'https://imatomstech.github.io/',   // แก้เป็น URL GitHub Pages จริงของคุณ
  DRIVE_FOLDER_ID: '',                         // เว้นว่าง = สร้างโฟลเดอร์ "iMATOMs sMART pLAN Backup" ให้อัตโนมัติ
  BACKUP_FOLDER_NAME: 'iMATOMs sMART pLAN Backup',
  DEFAULT_REMINDERS: [24, 1],                  // ชั่วโมงก่อนถึงกำหนด
  CHECK_EVERY_MINUTES: 15,
  DIGEST_HOUR: 7,
  OVERDUE_ALERT_WINDOW_HOURS: 24               // แจ้ง "ถึงกำหนดแล้ว" ถ้าเลยกำหนดไม่เกินกี่ชั่วโมง
};

var HEADERS = ['key','source','type','title','startMs','startText','location','owner','sh','detail','reminders','sent','overdueSent','updated'];

/* ═════════════════ Web endpoints ═════════════════ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'status') return json_(statusInfo_());
  return json_({ status: 'ok', app: CONFIG.APP_NAME, message: 'iMATOMs Apps Script is running' });
}

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = data.action || (data.filename ? 'backup' : '');
    if (action === 'backup')       return json_(saveBackup_(data.filename, data.content));
    if (action === 'syncSchedule') return json_(syncSchedule_(data));
    if (action === 'testEmail')    return json_(sendTestEmail_(data.email));
    if (action === 'status')       return json_(statusInfo_());
    return json_({ status: 'error', message: 'unknown action: ' + action });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ═════════════════ Setup ═════════════════ */

/** รันฟังก์ชันนี้ครั้งแรกจาก editor เพื่อ Authorize + ตั้ง Trigger */
function setup() {
  getSheet_('Items');
  getSheet_('Log');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'checkReminders' || fn === 'dailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkReminders').timeBased().everyMinutes(CONFIG.CHECK_EVERY_MINUTES).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(CONFIG.DIGEST_HOUR).everyDays(1)
    .inTimezone(CONFIG.TIMEZONE).create();
  sendTestEmail_();
  Logger.log('Setup complete. Spreadsheet: ' + getSpreadsheet_().getUrl());
}

/* ═════════════════ Storage (Google Sheet) ═════════════════ */

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ }
  }
  var ss = SpreadsheetApp.create('iMATOMs sMART pLAN — Notification Data');
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === 'Items') sh.appendRow(HEADERS);
    if (name === 'Log') sh.appendRow(['time', 'kind', 'to', 'subject', 'count']);
    sh.setFrozenRows(1);
    var s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
    if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  }
  return sh;
}

function readItems_() {
  var sh = getSheet_('Items');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return rows.map(function (r) {
    var o = {};
    HEADERS.forEach(function (h, i) { o[h] = r[i]; });
    o.startMs = Number(o.startMs);
    o.reminders = String(o.reminders || '').split(',').filter(String).map(Number);
    o.sent = String(o.sent || '').split(',').filter(String).map(Number);
    o.overdueSent = o.overdueSent === true || o.overdueSent === 'TRUE';
    return o;
  }).filter(function (o) { return o.key; });
}

function writeItems_(items) {
  var sh = getSheet_('Items');
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  if (!items.length) return;
  var rows = items.map(function (o) {
    return HEADERS.map(function (h) {
      var v = o[h];
      if (h === 'reminders' || h === 'sent') return (v || []).join(',');
      if (h === 'overdueSent') return !!v;
      return v === undefined || v === null ? '' : v;
    });
  });
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

function getEmail_() {
  return PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || CONFIG.NOTIFY_EMAIL;
}

/* ═════════════════ Sync from web app ═════════════════ */

function syncSchedule_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (data.email && /@/.test(data.email)) {
      PropertiesService.getScriptProperties().setProperty('NOTIFY_EMAIL', String(data.email).trim());
    }
    var old = {};
    readItems_().forEach(function (o) { old[o.key] = o; });
    var now = Date.now();
    var items = (data.items || []).map(function (it) {
      var startMs = Number(it.startMs);
      var prev = old[it.key];
      var sameTime = prev && Number(prev.startMs) === startMs;
      return {
        key: String(it.key),
        source: it.source || '',
        type: it.type || '',
        title: String(it.title || '(ไม่มีชื่อ)'),
        startMs: startMs,
        startText: fmt_(new Date(startMs), 'EEE d MMM yyyy HH:mm'),
        location: it.location || '',
        owner: it.owner || '',
        sh: it.sh || '',
        detail: String(it.detail || '').slice(0, 500),
        reminders: (it.reminders && it.reminders.length ? it.reminders : CONFIG.DEFAULT_REMINDERS).map(Number),
        sent: sameTime ? prev.sent : [],
        overdueSent: sameTime ? prev.overdueSent : false,
        updated: fmt_(new Date(now), 'yyyy-MM-dd HH:mm')
      };
    }).filter(function (o) { return o.key && !isNaN(o.startMs); });

    // รายการใหม่ที่ "ถึงช่วงเตือน" อยู่แล้วตอน sync → ถือว่าเตือนรอบนั้น ๆ ไปพร้อมกันในรอบตรวจถัดไป (ไม่ส่งซ้ำ)
    writeItems_(items);
    PropertiesService.getScriptProperties().setProperty('LAST_SYNC', String(now));
    return { status: 'ok', count: items.length, email: getEmail_(), syncedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function statusInfo_() {
  var p = PropertiesService.getScriptProperties();
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  return {
    status: 'ok',
    email: getEmail_(),
    lastSync: Number(p.getProperty('LAST_SYNC') || 0),
    triggers: triggers,
    sheetUrl: p.getProperty('SHEET_ID') ? 'https://docs.google.com/spreadsheets/d/' + p.getProperty('SHEET_ID') : ''
  };
}

/* ═════════════════ Reminder engine (trigger) ═════════════════ */

function checkReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var now = Date.now();
    var items = readItems_();
    var upcoming = [], overdue = [];

    items.forEach(function (it) {
      var diff = it.startMs - now; // ms ก่อนถึงกำหนด
      if (diff > 0) {
        var due = it.reminders.filter(function (h) { return diff <= h * 3600000; });
        var fresh = due.filter(function (h) { return it.sent.indexOf(h) < 0; });
        if (fresh.length) {
          upcoming.push(it);
          due.forEach(function (h) { if (it.sent.indexOf(h) < 0) it.sent.push(h); });
        }
      } else if (!it.overdueSent && -diff <= CONFIG.OVERDUE_ALERT_WINDOW_HOURS * 3600000) {
        overdue.push(it);
        it.overdueSent = true;
        it.reminders.forEach(function (h) { if (it.sent.indexOf(h) < 0) it.sent.push(h); });
      }
    });

    if (!upcoming.length && !overdue.length) return;

    upcoming.sort(function (a, b) { return a.startMs - b.startMs; });
    var subjectParts = [];
    if (overdue.length) subjectParts.push('ถึงกำหนดแล้ว ' + overdue.length);
    if (upcoming.length) subjectParts.push('ใกล้ถึงกำหนด ' + upcoming.length);
    var subject = '⏰ [iMATOMs] ' + subjectParts.join(' · ') + ' รายการ' +
      (upcoming.length === 1 && !overdue.length ? ' — ' + upcoming[0].title : '');

    var html = emailShell_('แจ้งเตือนงานใกล้ถึงกำหนด',
      (overdue.length ? section_('🔴 ถึงกำหนดแล้ว / เลยกำหนด', overdue, now, '#ef4444') : '') +
      (upcoming.length ? section_('🟡 ใกล้ถึงกำหนด', upcoming, now, '#f59e0b') : ''));

    send_(subject, html, upcoming.length + overdue.length, 'reminder');
    writeItems_(items);
  } finally {
    lock.releaseLock();
  }
}

function dailyDigest() {
  var now = new Date();
  var todayKey = fmt_(now, 'yyyy-MM-dd');
  var items = readItems_();
  var today = items.filter(function (it) { return fmt_(new Date(it.startMs), 'yyyy-MM-dd') === todayKey; })
    .sort(function (a, b) { return a.startMs - b.startMs; });
  var tomorrowKey = fmt_(new Date(now.getTime() + 86400000), 'yyyy-MM-dd');
  var tomorrow = items.filter(function (it) { return fmt_(new Date(it.startMs), 'yyyy-MM-dd') === tomorrowKey; })
    .sort(function (a, b) { return a.startMs - b.startMs; });
  var overdue = items.filter(function (it) {
    return it.startMs < now.getTime() && fmt_(new Date(it.startMs), 'yyyy-MM-dd') < todayKey;
  }).sort(function (a, b) { return a.startMs - b.startMs; });

  if (!today.length && !tomorrow.length && !overdue.length) return;

  var html = emailShell_('สรุปงานประจำวัน ' + fmt_(now, 'EEEE d MMMM yyyy'),
    (today.length ? section_('📅 งานวันนี้', today, now.getTime(), '#3b82f6') : '<p style="color:#6b7280">วันนี้ไม่มีงานที่มีกำหนดเวลา</p>') +
    (tomorrow.length ? section_('🗓️ พรุ่งนี้', tomorrow, now.getTime(), '#10b981') : '') +
    (overdue.length ? section_('⚠️ ค้าง / เลยกำหนด (ยังไม่ปิดงาน)', overdue, now.getTime(), '#ef4444') : ''));

  send_('📋 [iMATOMs] สรุปงานวันนี้ ' + fmt_(now, 'd MMM') + ' — ' + today.length + ' รายการ', html,
    today.length + tomorrow.length + overdue.length, 'digest');
}

function sendTestEmail_(email) {
  if (email && /@/.test(email)) PropertiesService.getScriptProperties().setProperty('NOTIFY_EMAIL', String(email).trim());
  var html = emailShell_('ทดสอบการเชื่อมต่อสำเร็จ ✅',
    '<p style="margin:0 0 8px">ระบบแจ้งเตือนอีเมลของ <b>' + CONFIG.APP_NAME + '</b> พร้อมใช้งานแล้ว</p>' +
    '<p style="margin:0;color:#6b7280;font-size:13px">ระบบจะตรวจทุก ' + CONFIG.CHECK_EVERY_MINUTES +
    ' นาที และส่งสรุปงานทุกเช้า ' + CONFIG.DIGEST_HOUR + ':00 น.</p>');
  send_('✅ [iMATOMs] ทดสอบระบบแจ้งเตือนอีเมล', html, 0, 'test');
  return { status: 'ok', email: getEmail_() };
}

/* ═════════════════ Email helpers ═════════════════ */

function send_(subject, html, count, kind) {
  var to = getEmail_();
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'iMATOMs sMART pLAN' });
  getSheet_('Log').appendRow([fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss'), kind, to, subject, count]);
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, CONFIG.TIMEZONE, pattern);
}

function esc_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function relative_(ms, now) {
  var diff = ms - now, abs = Math.abs(diff);
  var h = Math.floor(abs / 3600000), m = Math.round((abs % 3600000) / 60000);
  var d = Math.floor(h / 24);
  var txt = d >= 1 ? d + ' วัน ' + (h % 24) + ' ชม.' : (h >= 1 ? h + ' ชม. ' + m + ' นาที' : m + ' นาที');
  return diff >= 0 ? 'อีก ' + txt : 'เลยมา ' + txt;
}

var SOURCE_LABEL_ = { sched: '🗓️ Schedule', task: '📋 Daily Plan', inspect: '🔍 Inspection', dmaic: '📐 DMAIC' };

function section_(title, list, now, color) {
  var rows = list.map(function (it) {
    var meta = [SOURCE_LABEL_[it.source] || it.source, it.type, it.sh, it.location ? '📍 ' + it.location : '', it.owner ? '👤 ' + it.owner : '']
      .filter(String).map(esc_).join(' · ');
    return '<tr><td style="padding:10px 12px;border-bottom:1px solid #eef0f4;vertical-align:top">' +
      '<div style="font-weight:700;color:#111827;font-size:14px">' + esc_(it.title) + '</div>' +
      '<div style="color:#6b7280;font-size:12px;margin-top:2px">' + meta + '</div>' +
      (it.detail ? '<div style="color:#374151;font-size:12px;margin-top:4px">' + esc_(it.detail) + '</div>' : '') +
      '</td><td style="padding:10px 12px;border-bottom:1px solid #eef0f4;white-space:nowrap;text-align:right;vertical-align:top">' +
      '<div style="font-weight:700;color:#111827;font-size:13px">' + esc_(fmt_(new Date(it.startMs), 'd MMM HH:mm')) + '</div>' +
      '<div style="color:' + color + ';font-size:12px;font-weight:700">' + relative_(it.startMs, now) + '</div></td></tr>';
  }).join('');
  return '<h3 style="margin:18px 0 6px;font-size:15px;color:' + color + '">' + title + ' (' + list.length + ')</h3>' +
    '<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eef0f4;border-radius:8px">' + rows + '</table>';
}

function emailShell_(heading, body) {
  return '<div style="font-family:Sarabun,Tahoma,Arial,sans-serif;background:#f4f6fb;padding:20px">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">' +
    '<div style="background:linear-gradient(135deg,#1e3a8a,#0891b2);padding:16px 20px;color:#fff">' +
    '<div style="font-size:12px;opacity:.85;letter-spacing:1px">' + CONFIG.APP_NAME + '</div>' +
    '<div style="font-size:18px;font-weight:700;margin-top:2px">' + esc_(heading) + '</div></div>' +
    '<div style="padding:16px 20px">' + body +
    '<p style="margin:20px 0 0"><a href="' + CONFIG.APP_URL + '" style="background:#0891b2;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700">เปิด iMATOMs sMART pLAN</a></p>' +
    '</div><div style="padding:10px 20px;background:#f9fafb;color:#9ca3af;font-size:11px">ส่งอัตโนมัติจาก Google Apps Script · ' +
    esc_(fmt_(new Date(), 'd MMM yyyy HH:mm')) + '</div></div></div>';
}

/* ═════════════════ Backup to Drive ═════════════════ */

function getBackupFolder_() {
  if (CONFIG.DRIVE_FOLDER_ID) return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  var it = DriveApp.getFoldersByName(CONFIG.BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.BACKUP_FOLDER_NAME);
}

function saveBackup_(filename, content) {
  filename = filename || ('iMATOMs_backup_' + fmt_(new Date(), 'yyyy-MM-dd') + '.json');
  var folder = getBackupFolder_();
  var existing = folder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);
  folder.createFile(Utilities.newBlob(content || '', 'application/json', filename));
  return { status: 'ok', filename: filename };
}
