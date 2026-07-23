import { useGraph } from '../context/GraphContext';
import { useState, useEffect, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  detectQuantityUnitGuidance,
  getAxisUnitMismatchWarning,
  getAxisScaleMismatchWarning,
  getAxisUnitRecommendations,
  getUnitPrefixLabel,
  SCALE_AND_UNIT_CROSS_CHECK_MESSAGE,
  getGraphPatternGuidance,
  UNIT_PREFIX_SELECT_OPTIONS,
} from '../utils/quantityUnitGuidance';
import { fetchHistoricalScaleSuggestion, applyHistoricalAxisSuggestion, historicalSuggestionHasAxisSettings, PAST_CAPTURES_EMPTY_MESSAGE } from '../utils/graphScaleHistory';
import { getPreferredApiUrlSync, resolveApiUrl } from '../utils/apiBase';

const LOG_FIELDS = ['xMin', 'xMax', 'yMin', 'yMax'];

const EMPTY_LOG_PAIR_INPUTS = {
  xMin: { exponent: '', value: '' },
  xMax: { exponent: '', value: '' },
  yMin: { exponent: '', value: '' },
  yMax: { exponent: '', value: '' },
};

const DEFAULT_LOG_INPUT_MODE = {
  xMin: 'exponent',
  xMax: 'exponent',
  yMin: 'exponent',
  yMax: 'exponent',
};

const formatTemperatureNumber = (value) => {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1000) / 1000).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const parseTemperatureValue = (rawValue) => {
  const text = String(rawValue || '').trim();
  if (!text) {
    return { value: '', unit: 'C' };
  }

  const match = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:deg\s*)?(c|f|k)?\s*$/i);
  if (!match) {
    return { value: text, unit: 'C' };
  }

  return {
    value: match[1],
    unit: String(match[2] || 'C').toUpperCase(),
  };
};

const convertTemperatureToCelsius = (rawValue, unit) => {
  const numericValue = Number.parseFloat(String(rawValue || '').trim());
  if (!Number.isFinite(numericValue)) return '';

  if (unit === 'F') {
    return formatTemperatureNumber((numericValue - 32) * (5 / 9));
  }

  if (unit === 'K') {
    return formatTemperatureNumber(numericValue - 273.15);
  }

  return formatTemperatureNumber(numericValue);
};

export const CURVE_NAME_INPUT_ID = 'graph-capture-curve-name-input';

const GraphConfig = ({ showTctj = true, isGraphTitleReadOnly = false, isCurveNameReadOnly = false, isXTitleReadOnly = false, isYTitleReadOnly = false, initialCurveName = '', initialGraphTitle = '', initialXTitle = '', initialYTitle = '', isAxisMappingConfirmed = false, isEditingCurve = false, allowNextCurveNameEntry = false, isPartNumberFromUrl = false, isPartNumberLocked = false, showManufacturerField = false, showUsernameField = false, companyGraphId = '', sessionSavedCurves = [], curveNameAttention = false, captureUiPhase = '', onConfirmAxisMapping = () => {}, onRetakeAxis = () => {}, children = null }) => {
  const { graphConfig, setGraphConfig } = useGraph();
  const [apiUrl, setApiUrl] = useState(() => getPreferredApiUrlSync());
  const [logError, setLogError] = useState({ x: '', y: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [logPairInputs, setLogPairInputs] = useState(EMPTY_LOG_PAIR_INPUTS);
  const [logInputMode, setLogInputMode] = useState(DEFAULT_LOG_INPUT_MODE);
  const [temperatureValue, setTemperatureValue] = useState('');
  const [temperatureUnit, setTemperatureUnit] = useState('C');
  const skipTemperatureSyncRef = useRef(false);
  const isMetadataLocked = Boolean(isEditingCurve || isAxisMappingConfirmed);
  const isCurveNameFieldLocked = Boolean(
    isEditingCurve || isCurveNameReadOnly || (isAxisMappingConfirmed && !allowNextCurveNameEntry)
  );

  useEffect(() => {
    let cancelled = false;
    resolveApiUrl().then((url) => {
      if (!cancelled && url) setApiUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const quantityUnitGuidance = useMemo(
    () =>
      detectQuantityUnitGuidance({
        graphTitle: graphConfig.graphTitle,
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
      }),
    [graphConfig.graphTitle, graphConfig.xLabel, graphConfig.yLabel]
  );

  const yAxisUnitRecommendations = useMemo(
    () =>
      getAxisUnitRecommendations('y', {
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        graphTitle: graphConfig.graphTitle,
      }),
    [graphConfig.xLabel, graphConfig.yLabel, graphConfig.graphTitle]
  );

  const xAxisUnitRecommendations = useMemo(
    () =>
      getAxisUnitRecommendations('x', {
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        graphTitle: graphConfig.graphTitle,
      }),
    [graphConfig.xLabel, graphConfig.yLabel, graphConfig.graphTitle]
  );

  const yAxisUnitWarning = useMemo(
    () =>
      getAxisUnitMismatchWarning('y', {
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        graphTitle: graphConfig.graphTitle,
        unitPrefix: graphConfig.yUnitPrefix,
      }),
    [graphConfig.xLabel, graphConfig.yLabel, graphConfig.graphTitle, graphConfig.yUnitPrefix]
  );

  const xAxisUnitWarning = useMemo(
    () =>
      getAxisUnitMismatchWarning('x', {
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        graphTitle: graphConfig.graphTitle,
        unitPrefix: graphConfig.xUnitPrefix,
      }),
    [graphConfig.xLabel, graphConfig.yLabel, graphConfig.graphTitle, graphConfig.xUnitPrefix]
  );

  const xAxisScaleWarning = useMemo(
    () =>
      getAxisScaleMismatchWarning('x', {
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        graphTitle: graphConfig.graphTitle,
        scale: graphConfig.xScale,
      }),
    [graphConfig.xLabel, graphConfig.yLabel, graphConfig.graphTitle, graphConfig.xScale]
  );

  const yAxisScaleWarning = useMemo(
    () =>
      getAxisScaleMismatchWarning('y', {
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        graphTitle: graphConfig.graphTitle,
        scale: graphConfig.yScale,
      }),
    [graphConfig.xLabel, graphConfig.yLabel, graphConfig.graphTitle, graphConfig.yScale]
  );

  const showScaleAndUnitCrossCheckInModal = Boolean(
    xAxisUnitWarning ||
    yAxisUnitWarning ||
    xAxisScaleWarning ||
    yAxisScaleWarning
  );

  const graphPatternGuidance = useMemo(
    () =>
      getGraphPatternGuidance({
        graphTitle: graphConfig.graphTitle,
        xTitle: graphConfig.xLabel,
        yTitle: graphConfig.yLabel,
        partNumber: graphConfig.partNumber,
        manufacturer: graphConfig.manufacturer,
      }),
    [
      graphConfig.graphTitle,
      graphConfig.xLabel,
      graphConfig.yLabel,
      graphConfig.partNumber,
      graphConfig.manufacturer,
    ]
  );

  const [historicalScaleHint, setHistoricalScaleHint] = useState(null);

  const sessionCurvesFingerprint = useMemo(
    () =>
      (Array.isArray(sessionSavedCurves) ? sessionSavedCurves : [])
        .map(
          (curve) =>
            `${curve?.id || ''}:${curve?.config?.xScale || ''}:${curve?.config?.yScale || ''}:${curve?.config?.xMin || ''}:${curve?.config?.xMax || ''}:${curve?.config?.yMin || ''}:${curve?.config?.yMax || ''}`
        )
        .join(';'),
    [sessionSavedCurves]
  );

  const showScaleGuidancePanel =
    !isMetadataLocked &&
    Boolean(
      quantityUnitGuidance.length > 0 ||
        graphPatternGuidance ||
        historicalScaleHint?.message ||
        historicalScaleHint?.emptyMessage
    );

  const canApplyHistoricalAxisSuggestion =
    !isAxisMappingConfirmed &&
    !isEditingCurve &&
    historicalSuggestionHasAxisSettings(historicalScaleHint);

  const canApplyPatternDefaults =
    !isAxisMappingConfirmed &&
    !isEditingCurve &&
    Boolean(graphPatternGuidance?.defaultScales?.x || graphPatternGuidance?.defaultScales?.y);

  const handleApplyPatternDefaults = () => {
    if (!graphPatternGuidance) return;
    setGraphConfig((prev) => ({
      ...prev,
      ...(graphPatternGuidance.defaultScales?.x
        ? { xScale: graphPatternGuidance.defaultScales.x }
        : {}),
      ...(graphPatternGuidance.defaultScales?.y
        ? { yScale: graphPatternGuidance.defaultScales.y }
        : {}),
      ...(graphPatternGuidance.defaultUnits?.x
        ? { xUnitPrefix: graphPatternGuidance.defaultUnits.x }
        : {}),
      ...(graphPatternGuidance.defaultUnits?.y
        ? { yUnitPrefix: graphPatternGuidance.defaultUnits.y }
        : {}),
    }));
  };

  const handleApplyHistoricalAxisSuggestion = () => {
    const next = applyHistoricalAxisSuggestion(graphConfig, historicalScaleHint, {
      onlyFillDefaults: false,
    });
    if (next !== graphConfig) {
      setGraphConfig(next);
    }
  };

  useEffect(() => {
    if (initialCurveName || initialGraphTitle || initialXTitle || initialYTitle) {
      setGraphConfig((prevConfig) => ({
        ...prevConfig,
        curveName: initialCurveName || prevConfig.curveName,
        graphTitle: initialGraphTitle || prevConfig.graphTitle,
        xLabel: initialXTitle || prevConfig.xLabel,
        yLabel: initialYTitle || prevConfig.yLabel,
      }));
    }
  }, [initialCurveName, initialGraphTitle, initialXTitle, initialYTitle, setGraphConfig]);

  useEffect(() => {
    if (isMetadataLocked) {
      setHistoricalScaleHint(null);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await fetchHistoricalScaleSuggestion(
          apiUrl,
          {
            graphTitle: graphConfig.graphTitle,
            xLabel: graphConfig.xLabel,
            yLabel: graphConfig.yLabel,
            partNumber: graphConfig.partNumber,
            manufacturer: graphConfig.manufacturer,
            graphId: companyGraphId,
          },
          { sessionCurves: sessionSavedCurves }
        );
        if (cancelled) return;
        if (result) {
          setHistoricalScaleHint(result);
          return;
        }
        if (graphPatternGuidance) {
          setHistoricalScaleHint({
            suggestion: null,
            emptyMessage: PAST_CAPTURES_EMPTY_MESSAGE,
          });
        } else {
          setHistoricalScaleHint(null);
        }
      } catch {
        if (!cancelled && graphPatternGuidance) {
          setHistoricalScaleHint({
            suggestion: null,
            emptyMessage: PAST_CAPTURES_EMPTY_MESSAGE,
          });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    apiUrl,
    graphConfig.graphTitle,
    graphConfig.xLabel,
    graphConfig.yLabel,
    graphConfig.partNumber,
    graphConfig.manufacturer,
    companyGraphId,
    sessionCurvesFingerprint,
    graphPatternGuidance,
    isMetadataLocked,
  ]);

  // Validate min/max values
  useEffect(() => {
    let xErr = '', yErr = '';
    
    // Check if min > max for X-axis
    const xMin = parseFloat(graphConfig.xMin);
    const xMax = parseFloat(graphConfig.xMax);
    if (graphConfig.xScale === 'Logarithmic') {
      if ((!isNaN(xMin) && xMin <= 0) || (!isNaN(xMax) && xMax <= 0)) {
        xErr = '⚠️ Logarithmic axis values must be greater than 0';
      }
    }
    if (!isNaN(xMin) && !isNaN(xMax) && xMin >= xMax) {
      xErr = '⚠️ Min value must be less than Max value';
    }
    
    // Check if min > max for Y-axis
    const yMin = parseFloat(graphConfig.yMin);
    const yMax = parseFloat(graphConfig.yMax);
    if (graphConfig.yScale === 'Logarithmic') {
      if ((!isNaN(yMin) && yMin <= 0) || (!isNaN(yMax) && yMax <= 0)) {
        yErr = '⚠️ Logarithmic axis values must be greater than 0';
      }
    }
    if (!isNaN(yMin) && !isNaN(yMax) && yMin >= yMax) {
      yErr = '⚠️ Min value must be less than Max value';
    }
    
    setLogError({ x: xErr, y: yErr });
  }, [graphConfig.xScale, graphConfig.xMin, graphConfig.xMax, graphConfig.yScale, graphConfig.yMin, graphConfig.yMax]);

  // Helper function to round exponent to reasonable precision (avoid floating-point errors like 4.999999999)
  const roundExponent = (exp, decimals = 10) => {
    if (!Number.isFinite(exp)) return exp;
    // Round to N decimals to avoid floating-point precision artifacts
    return Math.round(exp * Math.pow(10, decimals)) / Math.pow(10, decimals);
  };

  const getUnitLabel = (value) => getUnitPrefixLabel(value);

  const formatUnitOptionLabel = (option, primaryPrefix) => {
    if (!option.value) return option.label;
    if (primaryPrefix && option.value === primaryPrefix) {
      return `${option.label} — recommended`;
    }
    return option.label;
  };

  const renderUnitSelect = (name, value, recommendations) => {
    const { primaryPrefix } = recommendations;

    return (
      <label className="block mb-3">
        <span className="block text-sm font-medium text-gray-800 mb-1">Unit:</span>
        <select
          name={name}
          value={value}
          onChange={handleChange}
          disabled={isAxisMappingConfirmed || isEditingCurve}
          className={`w-full px-3 py-2 border rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed ${
            primaryPrefix ? 'border-amber-400' : 'border-gray-300'
          }`}
        >
          <option value="">-select-</option>
          {UNIT_PREFIX_SELECT_OPTIONS.map((option) => {
            const isPrimary = primaryPrefix && option.value === primaryPrefix;
            return (
              <option
                key={option.value}
                value={option.value}
                style={
                  isPrimary
                    ? { fontWeight: 'bold', backgroundColor: '#fef3c7' }
                    : undefined
                }
              >
                {formatUnitOptionLabel(option, primaryPrefix)}
              </option>
            );
          })}
        </select>
        <p
          className="mt-1 text-xs text-amber-800 leading-snug"
          style={{ minHeight: '2.25rem' }}
        >
          {primaryPrefix ? (
            <>
              Recommended: <span className="font-semibold">{getUnitPrefixLabel(primaryPrefix)}</span>
            </>
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </p>
      </label>
    );
  };

  // Helper function to format actual values (avoid unnecessary trailing zeros)
  const formatActual = (val) => {
    if (!Number.isFinite(val)) return '';
    // For very large/small numbers, use exponential notation
    if (Math.abs(val) >= 1e10 || (Math.abs(val) < 1e-4 && val !== 0)) {
      return val.toExponential(6);
    }
    // Otherwise use fixed format, removing trailing zeros
    return String(val);
  };

  const formatAxisDisplay = (value, scale) => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return '?';
    return String(num);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Keep raw string value for numeric inputs to allow typing decimals like "0." or "1.2"
    // Parsing will happen when the value is actually used in calculations
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      [name]: value,
    }));
  };

  const updateGraphConfigField = (field, value) => {
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      [field]: value,
    }));
  };

  // Keep dual log inputs synchronized from graphConfig.
  useEffect(() => {
    setLogPairInputs((prev) => {
      const next = {
        ...prev,
        xMin: { ...prev.xMin },
        xMax: { ...prev.xMax },
        yMin: { ...prev.yMin },
        yMax: { ...prev.yMax },
      };

      LOG_FIELDS.forEach((field) => {
        const isXField = field.startsWith('x');
        const axisScale = isXField ? graphConfig.xScale : graphConfig.yScale;
        if (axisScale !== 'Logarithmic') return;

        const raw = graphConfig[field];
        const rawText = String(raw ?? '').trim();
        if (rawText === '') {
          next[field].exponent = '';
          next[field].value = '';
          return;
        }

        const numericValue = Number(rawText);
        if (!Number.isFinite(numericValue)) {
          next[field].value = rawText;
          return;
        }

        if (numericValue <= 0) {
          next[field].exponent = '';
          next[field].value = rawText;
          return;
        }

        const exponent = Math.log10(numericValue);
        next[field].exponent = String(roundExponent(exponent, 10));
        next[field].value = formatActual(numericValue);
      });

      return next;
    });
  }, [graphConfig.xScale, graphConfig.yScale, graphConfig.xMin, graphConfig.xMax, graphConfig.yMin, graphConfig.yMax]);

  useEffect(() => {
    if (skipTemperatureSyncRef.current) {
      skipTemperatureSyncRef.current = false;
      return;
    }

    const parsedTemperature = parseTemperatureValue(graphConfig.temperature);
    setTemperatureValue(parsedTemperature.value);
    setTemperatureUnit(parsedTemperature.unit);
  }, [graphConfig.temperature]);

  const handleLogInputModeChange = (field, mode) => {
    setLogInputMode((prev) => ({
      ...prev,
      [field]: mode,
    }));
  };

  const handleLogExponentChange = (field, value) => {
    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        exponent: value,
      },
    }));

    const exponentNumber = parseFloat(value);
    if (value.trim() === '' || !Number.isFinite(exponentNumber)) {
      setLogPairInputs((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          value: '',
        },
      }));
      updateGraphConfigField(field, '');
      return;
    }

    const actualValue = Math.pow(10, exponentNumber);
    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        exponent: value,
        value: formatActual(actualValue),
      },
    }));
    updateGraphConfigField(field, String(actualValue));
  };

  const handleLogActualValueChange = (field, value) => {
    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        value,
      },
    }));

    const actualNumber = parseFloat(value);
    if (value.trim() === '') {
      setLogPairInputs((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          exponent: '',
        },
      }));
      updateGraphConfigField(field, '');
      return;
    }

    if (!Number.isFinite(actualNumber) || actualNumber <= 0) {
      setLogPairInputs((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          exponent: '',
        },
      }));
      updateGraphConfigField(field, value);
      return;
    }

    const exponent = Math.log10(actualNumber);
    setLogPairInputs((prev) => ({
      ...prev,
      [field]: {
        exponent: String(roundExponent(exponent, 10)),
        value: formatActual(actualNumber),
      },
    }));
    updateGraphConfigField(field, String(actualNumber));
  };

  const handleTemperatureValueChange = (value) => {
    setTemperatureValue(value);
    const normalizedTemperature = value.trim() === ''
      ? ''
      : convertTemperatureToCelsius(value, temperatureUnit);

    skipTemperatureSyncRef.current = true;
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      temperature: normalizedTemperature,
    }));
  };

  const handleTemperatureUnitChange = (unit) => {
    setTemperatureUnit(unit);
    const normalizedTemperature = temperatureValue.trim() === ''
      ? ''
      : convertTemperatureToCelsius(temperatureValue, unit);

    skipTemperatureSyncRef.current = true;
    setGraphConfig((prevConfig) => ({
      ...prevConfig,
      temperature: normalizedTemperature,
    }));
  };

  const renderLogField = (field, label, placeholderExponent, placeholderValue, error) => {
    const activeMode = logInputMode[field] || 'exponent';

    return (
      <label className="block mb-3">
        <span className="block text-sm font-medium text-gray-800 mb-1">{label}:</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center flex-1">
            <span className={`px-3 py-2 border border-r-0 rounded-l text-sm text-gray-700 ${activeMode === 'exponent' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}>10^</span>
            <input
              type="text"
              inputMode="decimal"
              value={logPairInputs[field].exponent}
              onChange={(e) => handleLogExponentChange(field, e.target.value)}
              onMouseDown={() => { if (!isAxisMappingConfirmed && !isEditingCurve && activeMode !== 'exponent') { flushSync(() => handleLogInputModeChange(field, 'exponent')); } }}
              onFocus={() => !isAxisMappingConfirmed && !isEditingCurve && handleLogInputModeChange(field, 'exponent')}
              disabled={isAxisMappingConfirmed || isEditingCurve}
              placeholder={placeholderExponent}
              className={`w-full px-3 py-2 border rounded-r text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed ${activeMode === 'exponent' ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-300 opacity-50'}`}
              title="Exponent (click to use)"
            />
          </div>
          <span className="text-sm font-semibold text-gray-700">=</span>
          <input
            type="text"
            inputMode="decimal"
            value={logPairInputs[field].value}
            onChange={(e) => handleLogActualValueChange(field, e.target.value)}
            onMouseDown={() => { if (!isAxisMappingConfirmed && !isEditingCurve && activeMode !== 'value') { flushSync(() => handleLogInputModeChange(field, 'value')); } }}
            onFocus={() => !isAxisMappingConfirmed && !isEditingCurve && handleLogInputModeChange(field, 'value')}
            disabled={isAxisMappingConfirmed || isEditingCurve}
            placeholder={placeholderValue}
            className={`flex-1 px-3 py-2 border rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed ${activeMode === 'value' ? 'border-blue-500 ring-1 ring-blue-400' : 'border-gray-300 opacity-50'}`}
            title="Real value (click to use)"
          />
        </div>
        {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
      </label>
    );
  };

  const isNeedCurveNamePhase = captureUiPhase === 'needCurveName' || curveNameAttention;
  const isSetupPhase = captureUiPhase === 'setup';
  const showCompactLocked = Boolean(isAxisMappingConfirmed && !isEditingCurve);

  const handleUnlockAxes = () => {
    setLogInputMode(DEFAULT_LOG_INPUT_MODE);
    onRetakeAxis();
  };

  return (
    <div className="w-full p-5 bg-white rounded-lg mt-5 border border-gray-200">
      <h3 className="text-gray-900 text-lg font-semibold mb-5">Graph settings</h3>

      {showCompactLocked ? (
        <>
          <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="text-base font-semibold text-slate-900">Axes locked</div>
              <button
                type="button"
                onClick={handleUnlockAxes}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-sm font-medium text-slate-900 hover:bg-slate-100"
                style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                title="Edit axis settings (clears captured points)"
              >
                Edit axes
              </button>
            </div>
            <div className="text-sm text-slate-800 space-y-1.5">
              <div>
                <span className="font-medium">X</span>
                {': '}
                [{formatAxisDisplay(graphConfig.xMin, graphConfig.xScale)}, {formatAxisDisplay(graphConfig.xMax, graphConfig.xScale)}]
                {' · '}
                {graphConfig.xScale}
              </div>
              <div>
                <span className="font-medium">Y</span>
                {': '}
                [{formatAxisDisplay(graphConfig.yMin, graphConfig.yScale)}, {formatAxisDisplay(graphConfig.yMax, graphConfig.yScale)}]
                {' · '}
                {graphConfig.yScale}
              </div>
            </div>
          </div>

          <label className="block mb-5 font-medium text-gray-800">
            <span className="block mb-1 text-sm font-semibold text-gray-900">Curve or Line Name</span>
            <input
              id={CURVE_NAME_INPUT_ID}
              type="text"
              name="curveName"
              value={graphConfig.curveName}
              onChange={handleChange}
              placeholder="Enter curve name"
              className={`w-full px-3 py-2.5 border rounded text-sm text-gray-900 bg-white ${
                isNeedCurveNamePhase
                  ? 'border-amber-500 ring-2 ring-amber-300'
                  : 'border-gray-300'
              }`}
              readOnly={isCurveNameFieldLocked}
              disabled={isCurveNameFieldLocked}
            />
          </label>

          {children ? <div className="mb-4">{children}</div> : null}

          <details className="text-sm text-gray-700">
            <summary className="cursor-pointer select-none text-gray-600 hover:text-gray-900">
              Graph details
            </summary>
            <div className="mt-3 space-y-2 rounded border border-gray-200 bg-gray-50 p-3 text-gray-900">
              <div><span className="text-gray-600">Title:</span> {graphConfig.graphTitle || '—'}</div>
              <div><span className="text-gray-600">Part:</span> {graphConfig.partNumber || '—'}</div>
              <div><span className="text-gray-600">X title:</span> {graphConfig.xLabel || '—'}</div>
              <div><span className="text-gray-600">Y title:</span> {graphConfig.yLabel || '—'}</div>
            </div>
          </details>
        </>
      ) : (
        <>
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Names &amp; labels</p>
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm font-semibold text-gray-900">Graph Title:</span>
          <input
            type="text"
            name="graphTitle"
            value={graphConfig.graphTitle || ''}
            onChange={handleChange}
            placeholder="Enter graph title"
            className={`w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 ${
              isGraphTitleReadOnly || isMetadataLocked
                ? 'bg-gray-100 cursor-not-allowed opacity-70'
                : 'bg-white'
            }`}
            readOnly={isGraphTitleReadOnly || isMetadataLocked}
            disabled={isGraphTitleReadOnly || isMetadataLocked}
          />
        </label>
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm font-semibold text-gray-900">Curve or Line Name:</span>
          <input
            id={CURVE_NAME_INPUT_ID}
            type="text"
            name="curveName"
            value={graphConfig.curveName}
            onChange={handleChange}
            placeholder="Enter curve name"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            readOnly={isCurveNameFieldLocked}
            disabled={isCurveNameFieldLocked}
          />
        </label>
        {showManufacturerField && (
          <label className="block mb-3 font-medium text-gray-800">
            <span className="block mb-1 text-sm text-gray-800">Manufacturer:</span>
            <input
              type="text"
              name="manufacturer"
              value={graphConfig.manufacturer || ''}
              onChange={handleChange}
              placeholder="Enter manufacturer"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
              readOnly={isMetadataLocked}
              disabled={isMetadataLocked}
            />
          </label>
        )}
        {showUsernameField && (
          <label className="block mb-3 font-medium text-gray-800">
            <span className="block mb-1 text-sm text-gray-800">Username:</span>
            <input
              type="text"
              name="username"
              value={graphConfig.username || ''}
              onChange={handleChange}
              placeholder="Enter username((Email Id)"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
              readOnly={isMetadataLocked}
              disabled={isMetadataLocked}
            />
          </label>
        )}
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">Part Number:</span>
          <input
            type="text"
            name="partNumber"
            value={graphConfig.partNumber || ''}
            onChange={handleChange}
            placeholder="Enter part number"
            className={`w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 ${
              isPartNumberFromUrl || isPartNumberLocked || isMetadataLocked
                ? 'bg-gray-100 cursor-not-allowed opacity-70'
                : 'bg-white'
            }`}
            readOnly={isPartNumberFromUrl || isPartNumberLocked || isMetadataLocked}
            disabled={isPartNumberFromUrl || isPartNumberLocked || isMetadataLocked}
          />
        </label>
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm font-semibold text-gray-900">X Title:</span>
          <input
            type="text"
            name="xLabel"
            value={graphConfig.xLabel || ''}
            onChange={handleChange}
            placeholder="Enter X title"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            readOnly={isMetadataLocked || isXTitleReadOnly}
            disabled={isMetadataLocked || isXTitleReadOnly}
          />
        </label>
        <label className="block mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm font-semibold text-gray-900">Y Title:</span>
          <input
            type="text"
            name="yLabel"
            value={graphConfig.yLabel || ''}
            onChange={handleChange}
            placeholder="Enter Y title"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            readOnly={isMetadataLocked || isYTitleReadOnly}
            disabled={isMetadataLocked || isYTitleReadOnly}
          />
        </label>
      </div>

      {showScaleGuidancePanel ? (
        <div
          className="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-4 shadow-sm"
          role="note"
          aria-live="polite"
        >
          <p className="text-base font-bold text-amber-950 mb-2">
            Be careful while choosing scale and unit
          </p>
          <p className="text-sm sm:text-base text-amber-900 mb-3 leading-relaxed">
            Please choose scale and unit based on graph type and past captures. Verify they match the printed graph axes.
          </p>
          {graphPatternGuidance ? (
            <p className="text-sm sm:text-base text-amber-900 mb-3 leading-relaxed">
              <span className="font-semibold">{graphPatternGuidance.label}</span>
              {': '}
              {graphPatternGuidance.detail}
            </p>
          ) : null}
          {graphPatternGuidance && !historicalScaleHint?.message && !historicalScaleHint?.emptyMessage ? (
            <p className="text-sm sm:text-base text-amber-800 mb-3 leading-relaxed">
              Checking past captures...
            </p>
          ) : null}
          {historicalScaleHint?.message ? (
            <p className="text-sm sm:text-base text-amber-900 mb-3 leading-relaxed">
              <span className="font-semibold">Past captures:</span>
              {' '}
              {historicalScaleHint.message}
            </p>
          ) : null}
          {historicalScaleHint?.emptyMessage && !historicalScaleHint?.message ? (
            <p className="text-sm sm:text-base text-amber-900 mb-3 leading-relaxed">
              <span className="font-semibold">Past captures:</span>
              {' '}
              {historicalScaleHint.emptyMessage}
            </p>
          ) : null}
          {canApplyPatternDefaults ? (
            <div className="mb-3">
              <button
                type="button"
                onClick={handleApplyPatternDefaults}
                className="px-4 py-2 rounded bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
              >
                Use typical scale for this graph type
              </button>
              <p className="text-xs text-amber-800 mt-2">
                Sets the usual scale and units for graphs like this (e.g. logarithmic C–V). You still set min/max and align the blue box.
              </p>
            </div>
          ) : null}
          {canApplyHistoricalAxisSuggestion ? (
            <div className="mb-3">
              <button
                type="button"
                onClick={handleApplyHistoricalAxisSuggestion}
                className="px-4 py-2 rounded bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
              >
                Use axis settings from similar captures
              </button>
              <p className="text-xs text-amber-800 mt-2">
                Uses past graphs like this one from your saved curves. You still align the blue box and lock axes.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            {quantityUnitGuidance.map((entry) => (
              <p
                key={`${entry.source}_${entry.quantity}`}
                className="text-sm sm:text-base text-amber-900 leading-relaxed"
              >
                <span className="font-semibold">{entry.source}</span>
                {' — detected '}
                <span className="font-semibold">{entry.quantity}</span>
                {': expected units '}
                <span className="font-semibold">{entry.expectedUnits}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-6 mb-0">Axis min / max</p>
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-6 mt-3 rounded-lg ${
          isSetupPhase ? 'p-3 -mx-1 border border-gray-300 bg-gray-50' : ''
        }`}
        style={{
          opacity: (isAxisMappingConfirmed || isEditingCurve) ? 0.55 : 1,
          pointerEvents: (isAxisMappingConfirmed || isEditingCurve) ? 'none' : 'auto',
        }}
      >
        <div>
          <h4 className="text-gray-800 font-semibold mb-3">Y-Axis {isAxisMappingConfirmed && '🔒'} {isEditingCurve && '(disabled during edit)'}</h4>
          <label className="block mb-3">
            <span className="block text-sm font-semibold text-gray-900 mb-1">Scale:</span>
            <select name="yScale" value={graphConfig.yScale} onChange={handleChange} disabled={isAxisMappingConfirmed || isEditingCurve} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {renderUnitSelect('yUnitPrefix', graphConfig.yUnitPrefix, yAxisUnitRecommendations)}
          
          <div className="block mb-3 p-2 bg-blue-50 border border-blue-300 rounded text-xs text-blue-700" style={{ visibility: graphConfig.yScale === 'Logarithmic' ? 'visible' : 'hidden' }}>
            Enter either exponent or number value
          </div>
          
          {graphConfig.yScale === 'Logarithmic' ? (
            <>
              {renderLogField('yMin', 'Min', '-2', '0.01', logError.y)}
              {renderLogField('yMax', 'Max', '2', '100', logError.y)}
            </>
          ) : (
            <>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Min:</span>
                <input
                  type="number"
                  name="yMin"
                  value={graphConfig.yMin}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="number"
                  name="yMax"
                  value={graphConfig.yMax}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {logError.y && <span className="block text-xs text-red-600 mt-1">{logError.y}</span>}
              </label>
            </>
          )}
        </div>

        <div>
          <h4 className="text-gray-800 font-semibold mb-3">X-Axis {isAxisMappingConfirmed && '🔒'} {isEditingCurve && '(disabled during edit)'}</h4>
          <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-800 mb-1">Scale:</span>
            <select name="xScale" value={graphConfig.xScale} onChange={handleChange} disabled={isAxisMappingConfirmed || isEditingCurve} className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed">
              <option value="Linear">Linear</option>
              <option value="Logarithmic">Logarithmic</option>
            </select>
          </label>
          {renderUnitSelect('xUnitPrefix', graphConfig.xUnitPrefix, xAxisUnitRecommendations)}
          
          <div className="block mb-3 p-2 bg-blue-50 border border-blue-300 rounded text-xs text-blue-700" style={{ visibility: graphConfig.xScale === 'Logarithmic' ? 'visible' : 'hidden' }}>
            Enter either exponent or number value
          </div>
          
          {graphConfig.xScale === 'Logarithmic' ? (
            <>
              {renderLogField('xMin', 'Min', '-2', '0.01', logError.x)}
              {renderLogField('xMax', 'Max', '2', '100', logError.x)}
            </>
          ) : (
            <>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Min:</span>
                <input
                  type="number"
                  name="xMin"
                  value={graphConfig.xMin}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </label>
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-800 mb-1">Max:</span>
                <input
                  type="number"
                  name="xMax"
                  value={graphConfig.xMax}
                  onChange={handleChange}
                  disabled={isAxisMappingConfirmed || isEditingCurve}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {logError.x && <span className="block text-xs text-red-600 mt-1">{logError.x}</span>}
              </label>
            </>
          )}
        </div>
      </div>

      {showTctj && (
        <label className="block mt-5 mb-3 font-medium text-gray-800">
          <span className="block mb-1 text-sm text-gray-800">TC/TJ (Temperature):</span>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
            <input
              type="text"
              inputMode="decimal"
              value={temperatureValue}
              onChange={(e) => handleTemperatureValueChange(e.target.value)}
              disabled={isMetadataLocked}
              placeholder="Enter numeric temperature"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <select
              value={temperatureUnit}
              onChange={(e) => handleTemperatureUnitChange(e.target.value)}
              disabled={isMetadataLocked}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="C">deg C</option>
              <option value="F">F</option>
              <option value="K">K</option>
            </select>
          </div>
          <span className="block text-xs text-gray-500 mt-1">
            If left empty, room temperature is assumed: 25 deg C. Stored in the database as deg C.
          </span>
        </label>
      )}

      {children ? <div className="mt-4">{children}</div> : null}

      {/* Axis status & controls */}
      <div
        className="mt-6 p-4 border border-gray-300 rounded-lg bg-white"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isAxisMappingConfirmed ? (
              <span className="text-sm font-semibold text-gray-900">Axes locked</span>
            ) : (
              <span className="text-sm font-semibold text-gray-900">Lock axes when ready</span>
            )}
          </div>
        </div>
        
        {/* Always Display Current Axis Values */}
        <div className="text-sm text-gray-900 bg-gray-50 p-3 rounded mb-3 border border-gray-200">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <strong>X:</strong> [{formatAxisDisplay(graphConfig.xMin, graphConfig.xScale)}, {formatAxisDisplay(graphConfig.xMax, graphConfig.xScale)}] ({graphConfig.xScale})
            </div>
            <div>
              <strong>Y:</strong> [{formatAxisDisplay(graphConfig.yMin, graphConfig.yScale)}, {formatAxisDisplay(graphConfig.yMax, graphConfig.yScale)}] ({graphConfig.yScale})
            </div>
          </div>
        </div>
        
        {!isAxisMappingConfirmed && (
          <>
            {/* Validation messaging */}
            {(() => {
              const missing = [];
              if (!String(graphConfig.graphTitle || '').trim()) missing.push('Graph Title');
              if (!String(graphConfig.curveName || '').trim()) missing.push('Curve or Line Name');
              if (!String(graphConfig.xLabel || '').trim()) missing.push('X Title');
              if (!String(graphConfig.yLabel || '').trim()) missing.push('Y Title');
              if (!graphConfig.xMin && graphConfig.xMin !== 0) missing.push('X Min');
              if (!graphConfig.xMax && graphConfig.xMax !== 0) missing.push('X Max');
              if (!graphConfig.yMin && graphConfig.yMin !== 0) missing.push('Y Min');
              if (!graphConfig.yMax && graphConfig.yMax !== 0) missing.push('Y Max');
              
              const hasErrors = logError.x || logError.y;
              const isDisabled = missing.length > 0 || hasErrors;
              
              return (
                <>
                  {missing.length > 0 && (
                    <div className="mb-2 p-2 rounded bg-gray-50 border border-gray-300 text-xs text-gray-700">
                      Required: {missing.join(', ')}
                    </div>
                  )}
                  {hasErrors && (
                    <div className="mb-2 p-2 rounded bg-gray-50 border border-gray-300 text-xs text-red-700">
                      {logError.x}{logError.x && logError.y && ' | '}{logError.y}
                    </div>
                  )}
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    disabled={isDisabled}
                    className={`w-full px-4 py-2 rounded font-medium text-sm transition ${
                      isDisabled
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : 'bg-blue-700 text-white hover:bg-blue-800'
                    }`}
                    style={
                      isDisabled
                        ? { backgroundColor: '#e2e8f0', color: '#64748b' }
                        : { backgroundColor: '#1d4ed8', color: '#ffffff' }
                    }
                    title={isDisabled ? 'Fill required fields first' : 'Review settings, then lock axes to start clicking points'}
                  >
                    Lock axes
                  </button>
                </>
              );
            })()}
          </>
        )}
        
        {isAxisMappingConfirmed && (
          <button
            onClick={handleUnlockAxes}
            className="w-full mt-3 px-4 py-2 rounded font-medium bg-white text-slate-900 border border-slate-300 hover:bg-slate-50"
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
            title="Edit axis settings (clears captured points)"
          >
            Edit axes
          </button>
        )}
      </div>
        </>
      )}

      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              color: '#213547',
              borderRadius: 10,
              width: 'min(520px, 90vw)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
              padding: 20,
            }}
          >
            <div className="text-base font-semibold mb-3">Lock these axis settings?</div>
            <div className="text-sm mb-4" style={{ color: '#4b5563' }}>
              Confirm the values below. After you continue, axes are locked and you can click points on the graph.
            </div>
            {showScaleAndUnitCrossCheckInModal ? (
              <div className="mb-4 flex items-start gap-2 rounded-lg border-2 border-orange-400 bg-orange-50 px-3 py-2.5">
                <span className="text-xl font-bold leading-none text-orange-500" aria-hidden="true">
                  !
                </span>
                <p className="text-sm font-semibold text-orange-900 leading-snug">
                  {SCALE_AND_UNIT_CROSS_CHECK_MESSAGE}
                </p>
              </div>
            ) : null}
            <div className="text-sm" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div className="mb-2"><strong>Graph Title:</strong> {graphConfig.graphTitle || '-'}</div>
              <div className="mb-2"><strong>Curve or Line Name:</strong> {graphConfig.curveName || '-'}</div>
              <div className="mb-2"><strong>Part Number:</strong> {graphConfig.partNumber || '-'}</div>
              <div className="mb-2"><strong>X Title:</strong> {graphConfig.xLabel || '-'}</div>
              <div className="mb-3"><strong>Y Title:</strong> {graphConfig.yLabel || '-'}</div>
              <div className="mb-2"><strong>X Min:</strong> {formatAxisDisplay(graphConfig.xMin, graphConfig.xScale)}</div>
              <div className="mb-2"><strong>X Max:</strong> {formatAxisDisplay(graphConfig.xMax, graphConfig.xScale)}</div>
              <div className="mb-2"><strong>X Scale:</strong> {graphConfig.xScale || '-'}</div>
              <div className="mb-3"><strong>X Unit:</strong> {getUnitLabel(graphConfig.xUnitPrefix)}</div>
              <div className="mb-2"><strong>Y Min:</strong> {formatAxisDisplay(graphConfig.yMin, graphConfig.yScale)}</div>
              <div className="mb-2"><strong>Y Max:</strong> {formatAxisDisplay(graphConfig.yMax, graphConfig.yScale)}</div>
              <div className="mb-2"><strong>Y Scale:</strong> {graphConfig.yScale || '-'}</div>
              <div><strong>Y Unit:</strong> {getUnitLabel(graphConfig.yUnitPrefix)}</div>
            </div>
            <div className="text-xs mt-3" style={{ color: '#6b7280' }}>
              Need to change later? Use <strong>Edit axes</strong> (this clears captured points).
            </div>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                className="px-4 py-2 rounded bg-gray-800 text-white font-medium"
                onClick={() => setShowConfirmModal(false)}
              >
                No, go back
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-700 text-white font-medium"
                style={{ backgroundColor: '#1d4ed8', color: '#ffffff' }}
                onClick={() => {
                  setShowConfirmModal(false);
                  onConfirmAxisMapping();
                }}
              >
                Yes, lock axes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphConfig;
