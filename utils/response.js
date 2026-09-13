/**
 * Tiện ích response chuẩn cho API
 */

export function success(res, data, message = 'Thành công', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function error(res, message = 'Có lỗi xảy ra', statusCode = 500, details = null) {
  const response = {
    success: false,
    message,
  };
  if (details) {
    response.details = details;
  }
  return res.status(statusCode).json(response);
}