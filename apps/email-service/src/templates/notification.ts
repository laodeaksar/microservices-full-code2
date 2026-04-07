/**
 * Generates HTML content for notification emails.
 */
function generateNotificationHtml(
  orderId?: string,
  orderStatus?: string,
  text?: string,
): string {
  const statusColors: Record<string, string> = {
    pending: "#f59e0b",
    payment_confirmed: "#10b981",
    payment_failed: "#ef4444",
    confirmed: "#10b981",
    processing: "#3b82f6",
    shipped: "#8b5cf6",
    out_for_delivery: "#f97316",
    delivered: "#10b981",
    delivery_exception: "#ef4444",
    cancelled: "#6b7280",
    refunded: "#6b7280",
    return_requested: "#f59e0b",
    return_approved: "#10b981",
  };

  const status = orderStatus || "update";
  const color = statusColors[orderStatus] || "#3b82f6";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order ${status}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 20px 0;">
            <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <tr>
                <td style="background-color: ${color}; padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Order ${status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  ${orderId ? `<p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">Order #${orderId.slice(-6)}</p>` : ""}
                  <p style="margin: 0 0 20px 0; color: #111827; font-size: 16px; line-height: 1.5;">${text || "Your order status has been updated."}</p>
                  <table role="presentation" style="border-collapse: collapse; width: 100%;">
                    <tr>
                      <td style="padding: 15px; background-color: #f9fafb; border-radius: 6px; text-align: center;">
                        <span style="display: inline-block; padding: 8px 16px; background-color: ${color}; color: #ffffff; border-radius: 4px; font-size: 14px; font-weight: 500;">${status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px 30px; background-color: #f9fafb; text-align: center;">
                  <p style="margin: 0; color: #6b7280; font-size: 12px;">Need help? Contact our support team.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}
