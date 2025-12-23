class RenameApiKeyToIngestionKey < ActiveRecord::Migration[8.1]
  def change
    # Rename the index first, then the column
    if index_exists?(:apps, :api_key, name: 'index_apps_on_api_key')
      rename_index :apps, :index_apps_on_api_key, :index_apps_on_ingestion_key
    end
    rename_column :apps, :api_key, :ingestion_key
  end
end
