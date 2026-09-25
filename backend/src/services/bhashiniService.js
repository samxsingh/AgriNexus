/**
 * AgriNexus - Digital India Bhashini API Service Layer
 * 
 * Secure backend proxy for MeitY / Digital India Bhashini (ULCA) translation pipeline.
 * Features:
 *  - Native fetch (zero extra dependencies)
 *  - High-performance in-memory caching with TTL
 *  - Strict protected term preservation ("AgriNexus", Centre Codes, Currency amounts, IDs)
 *  - Graceful zero-error fallback when unconfigured, offline, or rate-limited
 *  - Voice-ready extension points for STT (Speech-to-Text) and TTS (Text-to-Speech)
 */

// Supported Indian regional languages confirmed on Bhashini pipeline
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिंदी' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' }
];

// Terms strictly protected from translation across all languages
const PROTECTED_TERMS = [
  'AgriNexus',
  'AGRINEXUS',
  'agrinexus',
  'Kisan',
  'Mandi',
  'MSP',
  'DBT',
  'UPI',
  'NEFT',
  'RTGS'
];

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

// In-memory translation cache: key -> { translatedText, timestamp }
const translationCache = new Map();
// In-memory full i18n bundle cache: lang -> bundleObject
const bundleCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class BhashiniService {
  constructor() {
    this.apiKey = env.BHASHINI_API_KEY || '';
    this.inferenceKey = env.BHASHINI_INFERENCE_KEY || env.BHASHINI_API_KEY || '';
    this.userId = env.BHASHINI_USER_ID || '';
    this.udyatApiKey = env.BHASHINI_UDYAT_API || env.BHASHINI_USER_ID || '';
    this.pipelineId = env.BHASHINI_PIPELINE_ID || '64392f96daac500b55c543d6';
    this.inferenceUrl = env.BHASHINI_API_URL || 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';
  }

  /**
   * Check if Bhashini credentials are fully configured.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(
      (this.apiKey || this.inferenceKey) &&
      (this.apiKey || this.inferenceKey).trim() !== '' &&
      (this.apiKey || this.inferenceKey) !== 'your_bhashini_api_key_here' &&
      this.userId &&
      this.userId.trim() !== '' &&
      this.userId !== 'your_bhashini_user_id_here'
    );
  }

  /**
   * Returns the list of officially supported Indian languages.
   * @returns {Array<{code: string, name: string, nativeName: string}>}
   */
  getSupportedLanguages() {
    return SUPPORTED_LANGUAGES;
  }

  /**
   * Mask protected terms, centre codes, and currency amounts before translation.
   * @param {string} text
   * @returns {{ maskedText: string, tokenMap: Map<string, string> }}
   */
  maskProtectedTerms(text) {
    if (!text || typeof text !== 'string') return { maskedText: text, tokenMap: new Map() };

    const tokenMap = new Map();
    let tokenIndex = 0;
    let masked = text;

    const addToken = (original) => {
      const token = `[[${tokenIndex++}]]`;
      tokenMap.set(token, original);
      return token;
    };

    // 0. Protect i18n placeholders like {{query}}, {{num}}, {{count}}
    masked = masked.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, (match) => addToken(match));

    // 1. Mask explicit brand and system terms
    PROTECTED_TERMS.forEach((term) => {
      const regex = new RegExp(`\\b${term}\\b`, 'g');
      masked = masked.replace(regex, (match) => addToken(match));
    });

    // 2. Mask centre codes and application IDs (e.g., LKO-GOM-001, SEH01, APP-2026-X, GOM01-101)
    const codeRegex = /\b[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3,4}\b|\b[A-Z]{3,5}[0-9]{2}-[0-9]{3,4}\b|\b[A-Z]{3}[0-9]{2}\b/g;
    masked = masked.replace(codeRegex, (match) => addToken(match));

    // 3. Mask currency amounts (e.g., ₹2,275 or Rs. 50,000)
    const currencyRegex = /(?:₹|Rs\.?)\s?[\d,]+(?:\.\d{2})?/g;
    masked = masked.replace(currencyRegex, (match) => addToken(match));

    return { maskedText: masked, tokenMap };
  }

  /**
   * Unmask previously replaced protected tokens back to original values.
   * @param {string} text
   * @param {Map<string, string>} tokenMap
   * @returns {string}
   */
  unmaskProtectedTerms(text, tokenMap) {
    if (!text || !tokenMap || tokenMap.size === 0) return text;

    let unmasked = text;
    tokenMap.forEach((originalValue, token) => {
      const id = token.replace(/[^0-9]/g, '');
      if (id !== '') {
        const flexibleRegex = new RegExp(`\\[{1,2}\\s*${id}\\s*\\]{1,2}`, 'g');
        unmasked = unmasked.replace(flexibleRegex, originalValue);
      }
      const escapedToken = token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      unmasked = unmasked.replace(new RegExp(`\\s*${escapedToken}\\s*`, 'g'), ` ${originalValue} `);
    });

    return unmasked.replace(/\s+/g, ' ').trim();
  }

  /**
   * Translate a single text string from source to target language.
   * Gracefully falls back to original text if Bhashini is unreachable or unconfigured.
   * @param {string} text
   * @param {string} targetLang
   * @param {string} [sourceLang='en']
   * @returns {Promise<{ translatedText: string, cached: boolean, fallback: boolean, notice?: string, error?: string }>}
   */
  async translate(text, targetLang = 'hi', sourceLang = 'en') {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return { translatedText: text, cached: false, fallback: false };
    }

    // Identical languages require no translation
    if (sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return { translatedText: text, cached: false, fallback: false };
    }

    const cacheKey = `${sourceLang}:${targetLang}:${text.trim()}`;
    const cachedEntry = translationCache.get(cacheKey);

    if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) {
      return { translatedText: cachedEntry.translatedText, cached: true, fallback: false };
    }

    // If Bhashini credentials are not present, return original text safely
    if (!this.isConfigured()) {
      return {
        translatedText: text,
        cached: false,
        fallback: true,
        notice: 'Bhashini API credentials not configured. Serving original language.'
      };
    }

    // Mask protected terms
    const { maskedText, tokenMap } = this.maskProtectedTerms(text);

    try {
      const payload = {
        pipelineTasks: [
          {
            taskType: 'translation',
            config: {
              language: {
                sourceLanguage: sourceLang,
                targetLanguage: targetLang
              }
            }
          }
        ],
        inputData: {
          input: [
            {
              source: maskedText
            }
          ]
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(this.inferenceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.inferenceKey || this.apiKey,
          ulcaApiKey: this.udyatApiKey || this.userId || this.apiKey,
          userId: this.userId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from Bhashini endpoint`);
      }

      const resData = await response.json();
      const output = resData?.pipelineResponse?.[0]?.output?.[0]?.target;
      if (output) {
        const finalTranslated = this.unmaskProtectedTerms(output, tokenMap);
        translationCache.set(cacheKey, {
          translatedText: finalTranslated,
          timestamp: Date.now()
        });

        return { translatedText: finalTranslated, cached: false, fallback: false };
      }

      throw new Error('Invalid pipeline response structure from Bhashini');
    } catch (err) {
      console.warn(`[Bhashini Service] Translation fallback (${sourceLang} -> ${targetLang}):`, err.message);
      // Resilient fallback: return original text with fallback flag
      return {
        translatedText: text,
        cached: false,
        fallback: true,
        error: err.message
      };
    }
  }

  /**
   * Batch translate multiple text strings.
   * Leverages Bhashini's native multi-input batch payload for maximum throughput.
   * @param {string[]} texts
   * @param {string} targetLang
   * @param {string} [sourceLang='en']
   * @returns {Promise<Array<{ original: string, translated: string, fallback: boolean }>>}
   */
  async batchTranslate(texts, targetLang = 'hi', sourceLang = 'en') {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    if (sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return texts.map((t) => ({ original: t, translated: t, fallback: false }));
    }

    const results = new Array(texts.length);
    const toTranslateIndices = [];

    // 1. Check in-memory translation cache
    texts.forEach((text, idx) => {
      if (!text || typeof text !== 'string' || text.trim() === '') {
        results[idx] = { original: text, translated: text, fallback: false };
        return;
      }
      const cacheKey = `${sourceLang}:${targetLang}:${text.trim()}`;
      const cached = translationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        results[idx] = { original: text, translated: cached.translatedText, fallback: false, cached: true };
      } else {
        toTranslateIndices.push(idx);
      }
    });

    if (toTranslateIndices.length === 0) return results;

    // Graceful fallback if unconfigured
    if (!this.isConfigured()) {
      toTranslateIndices.forEach((idx) => {
        results[idx] = { original: texts[idx], translated: texts[idx], fallback: true };
      });
      return results;
    }

    // 2. Translate in chunks of up to 40 strings using native Bhashini batch payload
    const CHUNK_SIZE = 40;
    for (let c = 0; c < toTranslateIndices.length; c += CHUNK_SIZE) {
      const chunkIndices = toTranslateIndices.slice(c, c + CHUNK_SIZE);
      const chunkItems = chunkIndices.map((idx) => {
        const text = texts[idx];
        const { maskedText, tokenMap } = this.maskProtectedTerms(text);
        return { idx, text, maskedText, tokenMap };
      });

      try {
        const payload = {
          pipelineTasks: [
            {
              taskType: 'translation',
              config: {
                language: {
                  sourceLanguage: sourceLang,
                  targetLanguage: targetLang
                }
              }
            }
          ],
          inputData: {
            input: chunkItems.map((item) => ({ source: item.maskedText }))
          }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(this.inferenceUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.inferenceKey || this.apiKey,
            ulcaApiKey: this.udyatApiKey || this.userId || this.apiKey,
            userId: this.userId
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const resData = await response.json();
          const outputs = resData?.pipelineResponse?.[0]?.output || [];

          chunkItems.forEach((item, oIdx) => {
            const outputTarget = outputs[oIdx]?.target;
            if (outputTarget) {
              const finalTranslated = this.unmaskProtectedTerms(outputTarget, item.tokenMap);
              const cacheKey = `${sourceLang}:${targetLang}:${item.text.trim()}`;
              translationCache.set(cacheKey, {
                translatedText: finalTranslated,
                timestamp: Date.now()
              });
              results[item.idx] = { original: item.text, translated: finalTranslated, fallback: false };
            } else {
              results[item.idx] = { original: item.text, translated: item.text, fallback: true };
            }
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        console.warn(`[Bhashini Batch] Chunk translation fallback (${sourceLang} -> ${targetLang}):`, err.message);
        chunkItems.forEach((item) => {
          results[item.idx] = { original: item.text, translated: item.text, fallback: true };
        });
      }
    }

    return results;
  }

  /**
   * Extension point for Bhashini Text-to-Speech (TTS).
   * Generates audio base64 for voice-guided procurement assistance.
   * @param {string} text
   * @param {string} language
   * @param {'female'|'male'} [gender='female']
   * @returns {Promise<{ audioContent: string|null, supported: boolean }>}
   */
  async textToSpeech(text, language = 'hi', gender = 'female') {
    if (!this.isConfigured()) {
      return {
        audioContent: null,
        supported: false,
        notice: 'Bhashini TTS requires active BHASHINI_API_KEY configuration.'
      };
    }

    try {
      const payload = {
        pipelineTasks: [
          {
            taskType: 'tts',
            config: {
              language: { sourceLanguage: language },
              gender
            }
          }
        ],
        inputData: {
          input: [{ source: text }]
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(this.inferenceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.inferenceKey || this.apiKey,
          ulcaApiKey: this.udyatApiKey || this.userId || this.apiKey,
          userId: this.userId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const resData = await response.json();
      const audioBase64 = resData?.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
      return { audioContent: audioBase64 || null, supported: Boolean(audioBase64) };
    } catch (err) {
      console.warn('[Bhashini TTS] Service unavailable:', err.message);
      return { audioContent: null, supported: false, error: err.message };
    }
  }

  /**
   * Extension point for Bhashini Automated Speech Recognition (ASR / STT).
   * Converts voice audio from farmers into text.
   * @param {string} audioBase64 Base64 encoded audio
   * @param {string} language Source language code
   * @returns {Promise<{ transcript: string, supported: boolean }>}
   */
  async speechToText(audioBase64, language = 'hi') {
    if (!this.isConfigured()) {
      return {
        transcript: '',
        supported: false,
        notice: 'Bhashini ASR requires active BHASHINI_API_KEY configuration.'
      };
    }

    try {
      const payload = {
        pipelineTasks: [
          {
            taskType: 'asr',
            config: {
              language: { sourceLanguage: language }
            }
          }
        ],
        inputData: {
          audio: [{ audioContent: audioBase64 }]
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(this.inferenceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.inferenceKey || this.apiKey,
          ulcaApiKey: this.udyatApiKey || this.userId || this.apiKey,
          userId: this.userId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const resData = await response.json();
      const transcript = resData?.pipelineResponse?.[0]?.output?.[0]?.source || '';
      return { transcript, supported: true };
    } catch (err) {
      console.warn('[Bhashini STT] Service unavailable:', err.message);
      return { transcript: '', supported: false, error: err.message };
    }
  }

  /**
   * Helper to load English base dictionary.
   */
  _getBaseEnglishBundle() {
    try {
      const enPath = path.join(__dirname, '../data/locales/en.json');
      if (fs.existsSync(enPath)) {
        return JSON.parse(fs.readFileSync(enPath, 'utf8'));
      }
      // Fallback path check if run from different cwd
      const altPath = path.resolve(__dirname, '../../../frontend/src/i18n/locales/en/translation.json');
      if (fs.existsSync(altPath)) {
        return JSON.parse(fs.readFileSync(altPath, 'utf8'));
      }
    } catch (e) {
      console.warn('[Bhashini Service] Failed to read en.json:', e.message);
    }
    return {};
  }

  /**
   * Get full i18n translation resource bundle for a language.
   * Checks in-memory cache, disk cache, or translates from English using Bhashini.
   * @param {string} lang Target language code (e.g. 'hi', 'mr', 'pa', 'gu', 'bn', 'ta', 'te')
   * @returns {Promise<object>}
   */
  async getLanguageBundle(lang) {
    if (!lang || typeof lang !== 'string') return {};
    const targetLang = lang.toLowerCase();

    // 1. If English, return base English bundle
    if (targetLang === 'en') {
      return this._getBaseEnglishBundle();
    }

    // 2. Check in-memory bundle cache
    if (bundleCache.has(targetLang)) {
      return bundleCache.get(targetLang);
    }

    // 3. Check persistent disk cache in backend/src/data/locales/${targetLang}.json
    const diskPath = path.join(__dirname, '../data/locales', `${targetLang}.json`);
    if (fs.existsSync(diskPath)) {
      try {
        const fileContent = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
        bundleCache.set(targetLang, fileContent);
        return fileContent;
      } catch (e) {
        console.warn(`[Bhashini Service] Failed to read disk bundle for ${targetLang}:`, e.message);
      }
    }

    // 4. Fallback: check frontend locales if available
    const fePath = path.resolve(__dirname, `../../../frontend/src/i18n/locales/${targetLang}/translation.json`);
    if (fs.existsSync(fePath)) {
      try {
        const feContent = JSON.parse(fs.readFileSync(fePath, 'utf8'));
        bundleCache.set(targetLang, feContent);
        return feContent;
      } catch (e) {
        // fallback
      }
    }

    // 5. If configured, translate on demand from English dictionary
    if (this.isConfigured()) {
      try {
        const bundle = await this._generateBundleFromEnglish(targetLang);
        if (bundle && Object.keys(bundle).length > 0) {
          bundleCache.set(targetLang, bundle);
          try {
            fs.writeFileSync(diskPath, JSON.stringify(bundle, null, 2), 'utf8');
          } catch (e) {
            // Non-fatal if disk is read-only
          }
          return bundle;
        }
      } catch (err) {
        console.warn(`[Bhashini Service] Bundle generation failed for ${targetLang}:`, err.message);
      }
    }

    // Fallback: return English base bundle
    return this._getBaseEnglishBundle();
  }

  /**
   * Helper to translate English base dictionary into target language using Bhashini.
   */
  async _generateBundleFromEnglish(targetLang) {
    const en = this._getBaseEnglishBundle();
    if (!en || Object.keys(en).length === 0) return {};

    const items = [];
    const walk = (obj, p = []) => {
      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
          walk(obj[k], [...p, k]);
        } else if (typeof obj[k] === 'string') {
          items.push({ path: [...p, k], text: obj[k] });
        }
      }
    };
    walk(en);

    const uniqueMap = new Map();
    items.forEach((it) => {
      if (!uniqueMap.has(it.text)) uniqueMap.set(it.text, null);
    });

    const uniqueTexts = Array.from(uniqueMap.keys());
    const translatedResults = await this.batchTranslate(uniqueTexts, targetLang, 'en');

    translatedResults.forEach((res, i) => {
      uniqueMap.set(uniqueTexts[i], res.translated || uniqueTexts[i]);
    });

    const result = JSON.parse(JSON.stringify(en));
    items.forEach((it) => {
      const translated = uniqueMap.get(it.text) || it.text;
      let curr = result;
      for (let i = 0; i < it.path.length - 1; i++) {
        curr = curr[it.path[i]];
      }
      curr[it.path[it.path.length - 1]] = translated;
    });

    return result;
  }

  /**
   * Clear in-memory translation and bundle cache.
   */
  clearCache() {
    translationCache.clear();
    bundleCache.clear();
  }

  /**
   * Return cache statistics.
   */
  getCacheStats() {
    return {
      entriesCount: translationCache.size,
      bundlesCount: bundleCache.size,
      ttlMs: CACHE_TTL_MS
    };
  }
}

module.exports = new BhashiniService();
