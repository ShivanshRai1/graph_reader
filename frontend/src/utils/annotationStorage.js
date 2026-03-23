/**
 * Utilities for persisting user annotations (captured points) to localStorage
 * Annotations are stored separately from imported curve data
 */

const ANNOTATION_STORAGE_KEY = 'graphAnnotations';

/**
 * Get all stored annotations (organized by curve ID)
 */
export const getAllAnnotations = () => {
  try {
    const stored = localStorage.getItem(ANNOTATION_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error reading annotations from localStorage:', error);
    return {};
  }
};

/**
 * Get annotations for a specific curve
 * @param {string} curveId - The curve ID to get annotations for
 * @returns {Array} Array of annotation points
 */
export const getAnnotationsForCurve = (curveId) => {
  if (!curveId) return [];
  
  try {
    const allAnnotations = getAllAnnotations();
    return allAnnotations[curveId] || [];
  } catch (error) {
    console.error(`Error reading annotations for curve ${curveId}:`, error);
    return [];
  }
};

/**
 * Save annotations for a specific curve
 * @param {string} curveId - The curve ID
 * @param {Array} points - Array of annotation points
 */
export const saveAnnotationsForCurve = (curveId, points) => {
  if (!curveId) return;

  try {
    const allAnnotations = getAllAnnotations();
    
    // Only store annotation points (those not marked as imported)
    const annotationsToStore = Array.isArray(points)
      ? points.filter(p => !p.imported).map(p => ({
          x: p.x,
          y: p.y,
          canvasX: p.canvasX,
          canvasY: p.canvasY,
          timestamp: p.timestamp || new Date().toISOString(),
        }))
      : [];

    if (annotationsToStore.length > 0) {
      allAnnotations[curveId] = annotationsToStore;
    } else {
      // Remove curve entry if no annotations
      delete allAnnotations[curveId];
    }
    
    localStorage.setItem(ANNOTATION_STORAGE_KEY, JSON.stringify(allAnnotations));
    console.log(`[ANNOTATIONS] Saved ${annotationsToStore.length} annotations for curve ${curveId}`);
  } catch (error) {
    console.error(`Error saving annotations for curve ${curveId}:`, error);
  }
};

/**
 * Clear all annotations for a specific curve
 * @param {string} curveId - The curve ID
 */
export const clearAnnotationsForCurve = (curveId) => {
  if (!curveId) return;

  try {
    const allAnnotations = getAllAnnotations();
    delete allAnnotations[curveId];
    localStorage.setItem(ANNOTATION_STORAGE_KEY, JSON.stringify(allAnnotations));
    console.log(`[ANNOTATIONS] Cleared all annotations for curve ${curveId}`);
  } catch (error) {
    console.error(`Error clearing annotations for curve ${curveId}:`, error);
  }
};

/**
 * Clear all annotations from storage
 */
export const clearAllAnnotations = () => {
  try {
    localStorage.removeItem(ANNOTATION_STORAGE_KEY);
    console.log('[ANNOTATIONS] Cleared all annotations');
  } catch (error) {
    console.error('Error clearing all annotations:', error);
  }
};

/**
 * Convert stored annotations to point objects with annotation marker
 * @param {Array} annotations - Stored annotations
 * @returns {Array} Points with isAnnotation flag
 */
export const convertAnnotationsToPoints = (annotations) => {
  if (!Array.isArray(annotations)) return [];
  
  return annotations.map(ann => ({
    x: ann.x,
    y: ann.y,
    canvasX: ann.canvasX,
    canvasY: ann.canvasY,
    imported: false,
    isAnnotation: true,
    timestamp: ann.timestamp,
  }));
};
