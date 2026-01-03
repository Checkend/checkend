Rails.application.routes.draw do
  # Setup wizard (only accessible when no users exist)
  constraints SetupRequiredConstraint do
    get 'setup', to: 'setup#index', as: :setup
    post 'setup/admin', to: 'setup#create_admin', as: :setup_admin
    get 'setup/team', to: 'setup#team', as: :setup_team
    post 'setup/team', to: 'setup#create_team', as: :setup_create_team
    get 'setup/app', to: 'setup#app', as: :setup_app
    post 'setup/app', to: 'setup#create_app', as: :setup_create_app
    get 'setup/complete', to: 'setup#complete', as: :setup_complete
  end

  # Ingestion API routes
  namespace :ingest do
    namespace :v1 do
      resources :errors, only: [ :create ]
    end
  end

  # Application API routes
  namespace :api do
    namespace :v1 do
      get 'health', to: 'health#show'
      resources :apps do
        resources :problems, only: [ :index, :show ] do
          member do
            post :resolve
            post :unresolve
          end
          collection do
            post :bulk_resolve
          end
          resources :notices, only: [ :index, :show ]
          resources :tags, only: [ :index, :create, :destroy ]
        end
      end
      resources :teams do
        resources :members, controller: 'team_members', only: [ :index, :create, :update, :destroy ]
        member do
          get :apps, action: :apps
          post :apps, action: :apps
          delete 'apps/:app_id', action: :apps_destroy
        end
      end
      resources :users
    end
  end

  # Development-only design routes
  if Rails.env.development?
    get 'design-internal', to: 'design#internal'
    get 'design-candidates', to: 'design#candidates'
  end

  resource :session
  resources :passwords, param: :token

  # User settings
  namespace :settings do
    resource :profile, only: [ :show ]
    resource :password, only: [ :edit, :update ] do
      post :verify, on: :collection
    end
    resources :sessions, only: [ :destroy ] do
      collection do
        delete :destroy_all_other
      end
    end
    resource :smtp, only: [ :show, :edit, :update ], controller: 'smtp' do
      post :test_connection, on: :collection
    end
  end

  # Apps management
  resources :apps do
    member do
      post :regenerate_ingestion_key
      get :setup_wizard
      post :assign_team
      delete :remove_team_assignment
    end
    resource :user_notification_preference, only: [ :edit, :update ], path: 'notification_preferences'
    resources :permissions, controller: 'app_permissions', only: [ :new, :create, :destroy ]
    resources :problems, only: [ :index, :show ] do
      member do
        post :resolve
        post :unresolve
      end
      collection do
        post :bulk_resolve
        post :bulk_unresolve
        post :bulk_add_tags
        post :bulk_remove_tags
      end
      resources :notices, only: [ :show ]
      resources :tags, only: [ :index, :create, :destroy ], controller: 'problem_tags'
    end
  end

  # Teams management
  resources :teams do
    resources :team_members, only: [ :index, :create, :update, :destroy ] do
      resource :permissions, controller: 'team_member_permissions', only: [ :edit, :update ]
    end
    resources :team_invitations, only: [ :index, :create, :update, :destroy ]
  end

  # Users management (admin only)
  resources :users, only: [ :index, :show, :edit, :update, :destroy ]

  # API Key management
  resources :api_keys, only: [ :index, :show, :new, :create, :destroy ] do
    member do
      delete :revoke
    end
  end

  # Team invitation acceptance (public route)
  get 'team_invitations/:token/accept', to: 'team_invitations#accept', as: :accept_team_invitation
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get 'up' => 'rails/health#show', as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  # Defines the root path route ("/")
  root 'dashboard#index'
end
