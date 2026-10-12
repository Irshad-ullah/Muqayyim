// Turns validation failures into the API's error shape:
//   400 { success:false, code:'VALIDATION_ERROR', message, errors:[{ field, message }] }
// `field` uses JS-style paths, e.g. "experience[1].endDate".

export const toFieldPath = (segments) =>
  segments.reduce((acc, seg) => {
    if (typeof seg === 'number' || /^\d+$/.test(String(seg))) return `${acc}[${seg}]`;
    return acc ? `${acc}.${seg}` : String(seg);
  }, '');

const dedupe = (errors) => {
  const seen = new Set();
  return errors.filter(({ field, message }) => {
    const key = `${field}\u0000${message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Zod issues → [{ field, message }], with an optional path prefix (the section).
export const formatZodIssues = (issues, prefix = []) =>
  dedupe(
    issues.flatMap((issue) => {
      const path = [...prefix, ...issue.path];
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) => ({
          field: toFieldPath([...path, key]),
          message: key === 'email' ? EMAIL_NOT_EDITABLE : 'Unknown field',
        }));
      }
      return [{ field: toFieldPath(path) || prefix.join('.') || 'body', message: issue.message }];
    }),
  );

export const EMAIL_NOT_EDITABLE = 'Email cannot be changed here. Use Account settings to change your email.';

export const summarize = (errors) =>
  errors.length === 1 ? errors[0].message : `${errors[0].message} (and ${errors.length - 1} more)`;

export const validationErrorBody = (errors, message) => ({
  success: false,
  code: 'VALIDATION_ERROR',
  message: message || summarize(errors),
  errors,
});

export const sendValidationError = (res, errors, message) => res.status(400).json(validationErrorBody(errors, message));

// ── Mongoose (second line of defence) ────────────────────────────────────────
export const isMongooseInputError = (err) => err?.name === 'ValidationError' || err?.name === 'CastError';

const mongoosePath = (p) => toFieldPath(String(p || '').split('.').filter(Boolean)) || 'body';

const mongooseMessage = (e) => {
  if (e.name === 'CastError') return `Must be a valid ${String(e.kind || 'value').toLowerCase()}`;
  if (e.kind === 'required') return 'This field is required';
  if (e.kind === 'maxlength') return `Must be at most ${e.properties?.maxlength} characters`;
  if (e.kind === 'enum') return 'Not an allowed value';
  return 'Invalid value';
};

// Values are never echoed back (Mongoose messages include them).
export const mongooseErrorsToFields = (err) => {
  if (err?.name === 'ValidationError') {
    // Keys are full paths ("experience.0.title"); e.path is relative to a subdocument.
    return dedupe(Object.entries(err.errors || {}).map(([path, e]) => ({ field: mongoosePath(path), message: mongooseMessage(e) })));
  }
  if (err?.name === 'CastError') return [{ field: mongoosePath(err.path), message: mongooseMessage(err) }];
  return [];
};
