// Google Apps Script Code - Paste this into a new project at script.google.com

// --- CONFIGURATION ---
// Define the structure of your data. Keys match the 'action' parameter.
const TABLES = ['Users', 'Inventory', 'Menu', 'Orders', 'PurchaseOrders', 'Transactions', 'Notifications'];

// --- DO POST (Write Data) ---
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000); // Wait up to 10s for concurrent access

  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    const username = params.username;

    if (!action) throw new Error("Missing action");

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. REGISTER
    if (action === 'REGISTER') {
      const password = String(params.password);
      if (!username || !password) throw new Error("Missing credentials");

      const usersSheet = getOrCreateSheet(ss, 'Users');
      const users = usersSheet.getDataRange().getValues();

      // Check if user exists
      for (let i = 1; i < users.length; i++) {
        if (String(users[i][0]) === String(username)) throw new Error("Username already taken");
      }

      // Store as text to prevent auto-formatting
      usersSheet.appendRow([String(username), "'" + password, new Date()]);
      return jsonResponse({ status: 'success', message: 'User registered' });
    }

    // 2. LOGIN
    if (action === 'LOGIN') {
      const password = String(params.password);
      const usernameString = String(username);

      const usersSheet = getOrCreateSheet(ss, 'Users');
      const users = usersSheet.getDataRange().getValues();

      for (let i = 1; i < users.length; i++) {
        // Enforce string comparison to avoid Type Mismatches (e.g. "1234" vs 1234)
        if (String(users[i][0]) === usernameString && String(users[i][1]) === password) {
          return jsonResponse({ status: 'success', message: 'Login successful' });
        }
      }
      throw new Error("Invalid credentials");
    }

    // 3. SYNC_DATA (Push whole tables or updates)
    // Expects: { action: 'SYNC_DATA', username: '...', data: { inventory: [...], orders: [...] } }
    if (action === 'SYNC_DATA') {
      if (!username) throw new Error("Missing username");
      const data = params.data;

      for (const tableName of TABLES) {
        if (tableName === 'Users') continue; // Don't sync users this way
        if (data[tableName]) {
          updateTable(ss, tableName, username, data[tableName]);
        }
      }
      return jsonResponse({ status: 'success', message: 'Data synced' });
    }

    throw new Error("Unknown action");

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// --- DO GET (Read Data) ---
function doGet(e) {
  try {
    const action = e.parameter.action;
    const username = e.parameter.username;

    if (action === 'GET_DATA') {
      if (!username) throw new Error("Missing username");

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const result = {};

      for (const tableName of TABLES) {
        if (tableName === 'Users') continue;
        result[tableName] = getTableData(ss, tableName, username);
      }

      return jsonResponse({ status: 'success', data: result });
    }

    return jsonResponse({ status: 'error', message: "Unknown GET action" });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// --- HELPERS ---

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // Add headers based on table type (Generic approach: keys from first data item)
    // For Users, we force it:
    if (name === 'Users') sheet.appendRow(['username', 'password', 'created_at']);
    else sheet.appendRow(['username', 'data_json', 'updated_at']); // Simple storage: User | JSON | Date
  }
  return sheet;
}

// Store data as JSON blobs per user to avoid schema migration hell
// Every table (except Users) has columns: [username, data_json, updated_at]
// This allows storing complex objects like 'ingredients' array inside a menu item without parsing CSVs.
function updateTable(ss, tableName, username, tableDataArray) {
  const sheet = getOrCreateSheet(ss, tableName);
  const data = sheet.getDataRange().getValues();

  // Strategy: Delete all rows for this user and rewrite. 
  // Efficient enough for small-medium businesses.

  // 1. Find rows to delete (keep others)
  // Reverse loop to delete safely
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === username) {
      sheet.deleteRow(i + 1);
    }
  }

  // 2. Add new rows
  // tableDataArray is the array of objects from the App state (e.g. inventory[])
  // We will store the WHOLE array as a single JSON blob or row-by-row?
  // Row-by-row is better for "spreadsheet viewing", but JSON blob is more robust for app sync.
  // The user asked for "Information in separate tabs".
  // Let's store EACH ITEM as a row, but flattened? 
  // Actually, keeping the JSON structure clean, let's store: [username, json_string, date]
  // Ideally, [username, id, json_body, date] so we can update specific items.

  // Let's go with: [username, id, full_json_string, updated_at]
  // This satisfies "visible data" (sort of) while keeping integrity.

  const newRows = tableDataArray.map(item => {
    return [username, item.id, JSON.stringify(item), new Date()];
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }
}

function getTableData(ss, tableName, username) {
  const sheet = ss.getSheetByName(tableName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const results = [];

  // Assuming format: [username, id, json, date]
  // Skip header
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      try {
        const item = JSON.parse(data[i][2]); // Parse the JSON col
        results.push(item);
      } catch (e) {
        // console.error("Bad JSON", e);
      }
    }
  }
  return results;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

