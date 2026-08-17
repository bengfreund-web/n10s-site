/**
 * N10s expression of interest — Google Apps Script endpoint.
 *
 * Setup:
 *  1. Create a Google Sheet to collect submissions.
 *  2. Extensions → Apps Script, paste this file over Code.gs, save.
 *  3. Deploy → New deployment → type "Web app".
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Copy the /exec URL into FORM_ENDPOINT at the top of js/main.js.
 *
 * Re-deploy (Deploy → Manage deployments → edit → new version) after any edit
 * here, otherwise the live URL keeps serving the old code.
 */

var SHEET_NAME = 'Interest';

var FIELDS = [
  'submittedAt',
  'firstName',
  'lastName',
  'organization',
  'cityState',
  'role',
  'email',
  'cell',
  'division',
  'teamCount',
  'notes'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(FIELDS);
      sheet.setFrozenRows(1);
    }

    var params = (e && e.parameter) || {};
    var row = FIELDS.map(function (field) {
      if (field === 'submittedAt') {
        return params.submittedAt || new Date().toISOString();
      }
      return params[field] || '';
    });
    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'N10s interest endpoint' }))
    .setMimeType(ContentService.MimeType.JSON);
}
