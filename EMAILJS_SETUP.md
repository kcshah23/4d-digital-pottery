# EmailJS Template Setup

1. Create an account at [emailjs.com](https://www.emailjs.com/).

2. **Add an Email Service** (e.g., Gmail) and note your **Service ID**.

3. **Create an Email Template** and note your **Template ID**.

4. **Template variables** – Use these in your template body:

   - `{{to_email}}` – Recipient email
   - `{{from_name}}` – Sender name
   - `{{message}}` – Short message
   - `{{postcard_image}}` – Base64 data URL of the postcard image

5. **Example template body** (HTML):

   ```html
   <p>You've received a digital pottery postcard from {{from_name}}!</p>
   <p>{{message}}</p>
   <p><img src="{{postcard_image}}" alt="Postcard" style="max-width:100%;" /></p>
   ```

   **Note:** Base64 images can be large. Some providers limit email size. If needed, upload the image elsewhere and pass a URL instead.

6. **Get your Public Key** from the EmailJS dashboard (Account → API Keys).

7. **Configure in `src/main.js`**:

   ```js
   const EMAILJS_CONFIG = {
     publicKey: 'YOUR_PUBLIC_KEY',
     serviceId: 'YOUR_SERVICE_ID',
     templateId: 'YOUR_TEMPLATE_ID',
   };
   ```
