from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

def encodings(sentence):
    embeddings = model.encode(sentence)
    return embeddings