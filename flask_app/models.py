from flask_sqlalchemy import SQLAlchemy
import json

db = SQLAlchemy()

class FactoryDesign(db.Model):
    __tablename__ = 'factory_designs'
    id                 = db.Column(db.Integer, primary_key=True)
    description        = db.Column(db.Text, nullable=False)
    file_path          = db.Column(db.String(255), nullable=False)
    description_vector = db.Column(db.Text(length=4294967295), nullable=False)

    def set_vector(self, vector_list):
        self.description_vector = json.dumps(vector_list)

    def get_vector(self):
        return json.loads(self.description_vector)


class GeneratedDesign(db.Model):
    __tablename__ = 'generated_designs'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    prompt     = db.Column(db.Text, nullable=False)
    file_path  = db.Column(db.String(255), nullable=False)
    rating     = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, server_default=db.func.now())


class ProductRequest(db.Model):
    __tablename__ = 'product_requests'
    id          = db.Column(db.Integer, primary_key=True)
    category    = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=False)
    created_at  = db.Column(db.DateTime, server_default=db.func.now())


class User(db.Model):
    __tablename__ = 'users'
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80),  unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role          = db.Column(db.String(20),  nullable=False, default='user')  # 'admin' | 'user'
    created_at    = db.Column(db.DateTime, server_default=db.func.now())