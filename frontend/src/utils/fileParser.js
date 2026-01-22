/**
 * Parse CSV content and extract X, Y data points
 * Expects format: X,Y (with optional header row)
 * @param {string} csvContent - The CSV file content
 * @returns {array} Array of {x, y} objects
 */
export const parseCSV = (csvContent) => {
  const lines = csvContent.trim().split('\n');
  const points = [];
  
  // Check if first row is a header by trying to parse as numbers
  let startIndex = 0;
  if (lines.length > 0) {
    const firstRowValues = lines[0].split(',').map(val => val.trim());
    if (isNaN(parseFloat(firstRowValues[0])) || isNaN(parseFloat(firstRowValues[1]))) {
      startIndex = 1; // Skip header row
    }
  }
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines
    
    const values = line.split(',').map(val => val.trim());
    if (values.length < 2) {
      throw new Error(`Row ${i + 1}: Expected at least 2 columns (X, Y)`);
    }
    
    const x = parseFloat(values[0]);
    const y = parseFloat(values[1]);
    
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`Row ${i + 1}: X and Y values must be numbers. Got: "${values[0]}", "${values[1]}"`);
    }
    
    points.push({ x, y });
  }
  
  return points;
};

/**
 * Parse JSON content and extract X, Y data points
 * Expects format: Array of objects with x and y properties
 * @param {string} jsonContent - The JSON file content
 * @returns {array} Array of {x, y} objects
 */
export const parseJSON = (jsonContent) => {
  let data;
  try {
    data = JSON.parse(jsonContent);
  } catch (error) {
    throw new Error(`Invalid JSON format: ${error.message}`);
  }
  
  if (!Array.isArray(data)) {
    throw new Error('JSON must contain an array of data points');
  }
  
  const points = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Item ${i}: Expected an object with x and y properties`);
    }
    
    const x = parseFloat(item.x);
    const y = parseFloat(item.y);
    
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`Item ${i}: x and y values must be numbers. Got: x="${item.x}", y="${item.y}"`);
    }
    
    points.push({ x, y });
  }
  
  return points;
};

/**
 * Parse file based on extension
 * @param {File} file - The file to parse
 * @returns {Promise} Promise resolving to array of {x, y} objects
 */
export const parseFile = async (file) => {
  const fileExtension = file.name.split('.').pop().toLowerCase();
  const content = await file.text();
  
  if (fileExtension === 'csv') {
    return parseCSV(content);
  } else if (fileExtension === 'json') {
    return parseJSON(content);
  } else {
    throw new Error(`Unsupported file format: .${fileExtension}. Please use .csv or .json`);
  }
};
