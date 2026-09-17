/**
 * Validation helpers dùng chung cho controllers.
 * Không phụ thuộc thư viện ngoài, dễ hiểu và mở rộng.
 */

/**
 * Kiểm tra giá trị có phải số hợp lệ không
 * @param {any} val
 * @returns {boolean}
 */
export function isValidNumber(val) {
  return typeof val === 'number' && !isNaN(val) && isFinite(val);
}

/**
 * Parse và validate số nguyên dương
 * @param {any} val
 * @param {Object} options
 * @param {number} options.min - Giá trị tối thiểu (mặc định 1)
 * @param {number} options.max - Giá trị tối đa
 * @param {number} options.defaultVal - Giá trị mặc định nếu không cung cấp
 * @returns {number|null} Số đã parse hoặc null nếu invalid
 */
export function parsePositiveInt(val, { min = 1, max = Number.MAX_SAFE_INTEGER, defaultVal = null } = {}) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = parseInt(val, 10);
  if (!isValidNumber(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

/**
 * Parse và validate số thực dương
 * @param {any} val
 * @param {Object} options
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} options.defaultVal
 * @returns {number|null}
 */
export function parsePositiveFloat(val, { min = 0, max = Number.MAX_SAFE_INTEGER, defaultVal = null } = {}) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = parseFloat(val);
  if (!isValidNumber(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

/**
 * Validate string không rỗng
 * @param {any} val
 * @param {Object} options
 * @param {number} options.minLength
 * @param {number} options.maxLength
 * @param {RegExp} options.pattern - Regex pattern để validate
 * @returns {string|null} String đã trim hoặc null nếu invalid
 */
export function validateString(val, { minLength = 1, maxLength = 1000, pattern = null } = {}) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) return null;
  if (pattern && !pattern.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate enum value
 * @param {any} val
 * @param {string[]} allowedValues
 * @param {boolean} caseInsensitive
 * @returns {string|null} Giá trị chuẩn hóa (uppercase nếu caseInsensitive) hoặc null
 */
export function validateEnum(val, allowedValues, caseInsensitive = true) {
  if (typeof val !== 'string') return null;
  const normalized = caseInsensitive ? val.toUpperCase() : val;
  return allowedValues.includes(normalized) ? normalized : null;
}

/**
 * Validate object body có chứa các field bắt buộc
 * @param {Object} body
 * @param {string[]} requiredFields
 * @returns {Object} { valid: boolean, missing: string[] }
 */
export function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter((field) => {
    const val = body[field];
    return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
  });
  return { valid: missing.length === 0, missing };
}

/**
 * Validate MongoDB ObjectId
 * @param {string} id
 * @returns {boolean}
 */
export function isValidObjectId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Middleware validation cho query params phổ biến
 * @param {Object} schema - Định nghĩa validation cho từng param
 * @returns {Function} Express middleware
 */
export function queryValidator(schema) {
  return (req, res, next) => {
    const errors = [];
    const validated = {};

    for (const [key, rules] of Object.entries(schema)) {
      const val = req.query[key];
      const { required = false, type = 'string', ...typeOptions } = rules;

      if (required && (val === undefined || val === null || val === '')) {
        errors.push(`${key} là bắt buộc`);
        continue;
      }

      if (val === undefined || val === null || val === '') {
        validated[key] = typeOptions.default ?? null;
        continue;
      }

      let result = null;
      switch (type) {
        case 'int':
          result = parsePositiveInt(val, typeOptions);
          break;
        case 'float':
          result = parsePositiveFloat(val, typeOptions);
          break;
        case 'string':
          result = validateString(val, typeOptions);
          break;
        case 'enum':
          result = validateEnum(val, typeOptions.values, typeOptions.caseInsensitive);
          break;
        default:
          result = val;
      }

      if (result === null && required) {
        errors.push(`${key} không hợp lệ`);
      } else {
        validated[key] = result;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tham số truy vấn không hợp lệ',
        details: errors,
      });
    }

    // Gán validated params vào req.validatedQuery để controller dùng
    req.validatedQuery = validated;
    next();
  };
}

/**
 * Middleware validation cho body
 * @param {Object} schema
 * @returns {Function} Express middleware
 */
export function bodyValidator(schema) {
  return (req, res, next) => {
    const errors = [];
    const validated = {};

    for (const [key, rules] of Object.entries(schema)) {
      const val = req.body[key];
      const { required = false, type = 'string', ...typeOptions } = rules;

      if (required && (val === undefined || val === null || val === '')) {
        errors.push(`${key} là bắt buộc`);
        continue;
      }

      if (val === undefined || val === null || val === '') {
        validated[key] = typeOptions.default ?? null;
        continue;
      }

      let result = null;
      switch (type) {
        case 'int':
          result = parsePositiveInt(val, typeOptions);
          break;
        case 'float':
          result = parsePositiveFloat(val, typeOptions);
          break;
        case 'string':
          result = validateString(val, typeOptions);
          break;
        case 'enum':
          result = validateEnum(val, typeOptions.values, typeOptions.caseInsensitive);
          break;
        default:
          result = val;
      }

      if (result === null && required) {
        errors.push(`${key} không hợp lệ`);
      } else {
        validated[key] = result;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Dữ liệu gửi lên không hợp lệ',
        details: errors,
      });
    }

    req.validatedBody = validated;
    next();
  };
}