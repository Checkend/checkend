Rails.application.routes.draw do
  # API routes
  namespace :api do
    namespace :v1 do
      resources :errors, only: [:create]
    end
  end

  # Development-only design routes
  if Rails.env.development?
    get "design-internal", to: "design#internal"
    get "design-candidates", to: "design#candidates"
  end

  resource :session
  resources :passwords, param: :token

  # User settings
  namespace :settings do
    resource :password, only: [:edit, :update]
  end

  # Apps management
  resources :apps do
    member do
      post :regenerate_api_key
    end
  end
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  # Defines the root path route ("/")
  root "dashboard#index"
end
