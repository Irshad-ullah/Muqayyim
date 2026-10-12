import { randomUUID } from 'crypto';

// Request correlation id. The API Gateway sets X-Request-Id on every request;
// a valid incoming id is kept, otherwise (e.g. direct internal calls) a new one
// is generated. Available as req.requestId and echoed on the response.
const VALID_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

const requestId = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export default requestId;
