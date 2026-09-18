/**
 * Tek bir formu bağlar.
 *
 * `data-target` verilirse başarılı yanıtın gövdesi o bölgeye takılır; yoksa
 * yanıt formun kendisini değiştirir (doğrulama hatalarının geldiği yol).
 *
 * @param {HTMLFormElement} form
 * @returns {() => void} Dinleyiciyi söken fonksiyon.
 */
export declare function enhanceForm(form: HTMLFormElement): () => void;
/**
 * `data-enhance` taşıyan formları tek bir delege dinleyiciyle bağlar.
 * `submit` olayı köpürdüğü için sonradan DOM'a giren (fragment ile gelen)
 * formlar da kapsanır ve her takastan sonra yeniden bağlama gerekmez.
 *
 * @param {ParentNode} [root]
 * @returns {() => void}
 */
export declare function startForms(root?: ParentNode): () => void;
