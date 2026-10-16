// Picture inputs for templates that start with an image.
export function ImageFields() {
  return (
    <fieldset className="card stack">
      <legend><b>Picture</b> (this template starts with an image)</legend>
      <label>Upload a JPG or PNG (under 4 MB, square or 1.91:1 looks best)
        <input type="file" name="image_file" accept="image/jpeg,image/png" />
      </label>
      <label>…or paste a public image link
        <input type="url" name="image_link" placeholder="https://ahg53.bond/images/diwali-offer.jpg" />
      </label>
      <p className="muted">Uploaded pictures are stored by WhatsApp for about 30 days, enough for any scheduled campaign.</p>
    </fieldset>
  );
}
