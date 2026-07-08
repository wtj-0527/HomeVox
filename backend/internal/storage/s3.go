package storage

// S3/MinIO client boundary. Phase 0 keeps this as an interface seam so
// concrete SDK selection can be validated before upload/download flows land.
type ObjectStore interface {
	PutObject(key string, contentType string, data []byte) error
	GetObject(key string) ([]byte, error)
}
