# iMATOMs sMART pLAN V1.0

ระบบวางแผนและติดตามงานของ TKO / iMATOMs — Daily Plan (Eisenhower 4Q), Schedule Work, Progress Report,
Inspection & RCA, DMAIC, TOILET Assessment พร้อม **แจ้งเตือนอีเมลอัตโนมัติ** ไปที่ `imatomsapps1976@gmail.com`
เมื่องานใกล้ถึงกำหนด

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | ตัวโปรแกรมทั้งหมด (ไฟล์เดียว) — ขึ้น GitHub Pages |
| `Code.gs` | Google Apps Script — ส่งอีเมลแจ้งเตือน + สรุปงานทุกเช้า + เก็บ Backup ลง Drive |

**Admin login:** `tkoplan` (รหัสผ่านตามที่กำหนด — ในโค้ดเก็บเป็น SHA-256 hash ไม่ใช่ข้อความจริง)

---

## 1) ขึ้น GitHub Pages (บัญชี imatomstech)

1. สร้าง repo ใหม่ เช่น `imatoms-smart-plan` (Public)
2. **Add file → Upload files** → อัปโหลด `index.html`, `Code.gs`, `README.md` → Commit
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save
4. รอ 1–2 นาที จะได้ URL: `https://imatomstech.github.io/imatoms-smart-plan/`

## 2) ตั้งค่าอีเมลแจ้งเตือน (ทำครั้งเดียว ~5 นาที)

1. Login Google ด้วย **imatomsapps1976@gmail.com** → เปิด <https://script.google.com> → **New project**
2. วางโค้ดจาก `Code.gs` แทนโค้ดเดิมทั้งหมด (หรือกดปุ่ม *📋 Copy Code.gs* ในแอป)
3. แก้ `APP_URL` ใน `CONFIG` ให้เป็น URL GitHub Pages ของคุณ → **Save**
4. เลือกฟังก์ชัน **`setup`** → **Run** → Authorize (*Advanced → Go to … (unsafe) → Allow*)
   - ระบบสร้าง Google Sheet เก็บรายการแจ้งเตือน + Trigger ตรวจทุก 15 นาที + สรุปงาน 07:00 น.
   - จะได้อีเมลทดสอบ 1 ฉบับ
5. **Deploy → New deployment** → ⚙️ **Web app** → Execute as: **Me** · Who has access: **Anyone** → Deploy
6. คัดลอก **Web app URL** (ลงท้าย `/exec`)
7. ในแอป: **🗓️ Schedule Work → ⚙️ ตั้งค่าแจ้งเตือน** → วาง URL → **🔄 บันทึก + Sync** → **✉️ ทดสอบส่งอีเมล**

> แก้โค้ด Apps Script ภายหลัง → *Deploy → Manage deployments → Edit → Version: New version* (URL เดิมใช้ต่อได้)

### การแจ้งเตือนทำงานอย่างไร

- ทุกครั้งที่ บันทึก/แก้ไข/ลบ งาน แอปจะส่งรายการที่มีกำหนดเวลา (60 วันข้างหน้า) ไปเก็บใน Google Sheet ของ Apps Script
- Apps Script ตรวจทุก 15 นาที และส่งอีเมลเมื่อ
  - **ใกล้ถึงกำหนด** — ตามช่วงที่เลือก (1 สัปดาห์ / 3 วัน / 1 วัน / 3 ชม. / 1 ชม.) แต่ละช่วงส่งครั้งเดียว
  - **ถึงกำหนดแล้ว** — ครั้งเดียว ภายใน 24 ชม. หลังถึงกำหนด (ถ้ายังไม่ปิดงาน)
- ทุกเช้า **07:00 น.** ส่งสรุป: งานวันนี้ · พรุ่งนี้ · งานค้าง
- แหล่งงานที่แจ้งเตือน: Schedule Work, Daily Plan (กำหนดเสร็จ), Inspection Follow-up, DMAIC Target (เปิด/ปิดได้)
- งานที่ทำเครื่องหมาย ✅ เสร็จ / ยกเลิก จะไม่ถูกแจ้งเตือน

## 3) ข้อควรรู้

- **ข้อมูลเก็บใน browser (localStorage) ของแต่ละเครื่อง** — แต่ละเครื่อง/แต่ละคนเห็นข้อมูลของตัวเอง
  ใช้ *Admin Panel → Export / Import* (หรือปุ่ม 💾 Backup ด่วน) เพื่อย้ายหรือสำรองข้อมูล
- อีเมลแจ้งเตือนใช้ข้อมูล **ที่ซิงค์ล่าสุด** — ถ้าแก้งานในเครื่องหนึ่ง ต้องเปิดแอปเครื่องนั้นให้ซิงค์ (อัตโนมัติเมื่อบันทึก และทุก 30 นาทีขณะเปิดแอป)
- Gmail ส่วนตัวส่งอีเมลจาก Apps Script ได้ประมาณ 100 ฉบับ/วัน (ระบบรวมหลายงานไว้ในอีเมลเดียวต่อรอบ)
- Repo เป็น Public — อย่าใส่ข้อมูลลับลงในโค้ด (Claude API Key ตั้งค่าผ่าน Admin Panel และเก็บในเครื่องเท่านั้น)
