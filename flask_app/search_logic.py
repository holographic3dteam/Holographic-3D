import json
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from models import FactoryDesign, db 

# تحميل الموديل مرة واحدة فقط هنا
print("Loading Embedding Model in Search Logic...")
# Keep this tiny (~90MB) model on the CPU — encoding one short prompt is instant
# there, and it frees GPU VRAM for SDXL (the 8GB card is the bottleneck).
embedding_model = SentenceTransformer('all-MiniLM-L6-v2', device='cpu')

def search_factory_products(prompt):
    if not prompt:
        return None

    # تحويل طلب المستخدم لـ vector
    prompt_vector = embedding_model.encode(prompt).reshape(1, -1)
    
    # جلب الداتا من الداتابيز
    designs = FactoryDesign.query.all()
    if not designs:
        return None

    results = []
    for design in designs:
        try:
            stored_vector = design.get_vector()
            design_vector = np.array(stored_vector).reshape(1, -1)
            
            # حساب التشابه
            score = cosine_similarity(prompt_vector, design_vector)[0][0]

            results.append({
                "id": design.id,
                "description": design.description,
                "file_path": design.file_path,
                "score": float(score)
            })
        except Exception as e:
            print(f"Error processing design {design.id}: {e}")
            continue

    # الترتيب من الأعلى للأقل
    results.sort(key=lambda x: x["score"], reverse=True)

    # إرجاع أفضل نتيجة لو الـ score أكبر من 0.2
    return results[0] if results and results[0]['score'] > 0.2 else None